const googleTranslate = require("googletrans").default;
const { translateDeepLBatch } = require("./deepl-translator");
const { cueTextForTranslation } = require("./subtitle-parser");

const BATCH_LIMITS = {
    deepl: {
        chars: 100000,
        texts: 50,
    },
    googletrans: {
        chars: 10000,
        texts: 50,
    },
};

const BATCH_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

async function translateCues(cues, config) {
    const translated = new Array(cues.length).fill("");
    const limits = batchLimits(config);
    let batch = [];
    let batchIndexes = [];
    let batchChars = 0;

    async function flushBatch() {
        if (!batch.length) return;

        const result = await translateBatch(batch, config);
        result.forEach((text, index) => {
            translated[batchIndexes[index]] = cleanTranslatedText(text);
        });

        batch = [];
        batchIndexes = [];
        batchChars = 0;
    }

    for (let index = 0; index < cues.length; index += 1) {
        const text = cueTextForTranslation(cues[index]);
        if (!text) continue;

        if (batch.length >= limits.texts || batchChars + text.length > limits.chars) {
            await flushBatch();
        }

        batch.push(text);
        batchIndexes.push(index);
        batchChars += text.length;
    }

    await flushBatch();
    return translated;
}

function batchLimits(config) {
    return BATCH_LIMITS[translationProvider(config)] || BATCH_LIMITS.googletrans;
}

async function translateBatch(texts, config) {
    if (translationProvider(config) === "deepl") {
        return withRetries(() => translateDeepLBatch(texts, config));
    }

    try {
        const result = await withRetries(() =>
            googleTranslate(texts, {
                from: config.googleSourceLanguage,
                to: config.googleTargetLanguage,
            }),
        );
        return result.textArray || [result.text];
    } catch (error) {
        if (texts.length === 1) throw error;

        const translated = [];
        for (const text of texts) {
            const result = await withRetries(() =>
                googleTranslate(text, {
                    from: config.googleSourceLanguage,
                    to: config.googleTargetLanguage,
                }),
            );
            translated.push(result.text);
        }
        return translated;
    }
}

async function withRetries(run, { retries = BATCH_RETRIES } = {}) {
    let lastError;

    for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
            return await run();
        } catch (error) {
            lastError = error;
            if (attempt < retries - 1) await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * 100);
        }
    }

    throw lastError;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function translationProvider(config = {}) {
    const provider = String(config.translationProvider).trim().toLowerCase();
    return provider ?? "googletrans";
}

function cleanTranslatedText(text) {
    return String(text || "")
        .replace(/[ \t]+/g, " ")
        .trim();
}

module.exports = {
    batchLimits,
    translateCues,
    translationProvider,
};
