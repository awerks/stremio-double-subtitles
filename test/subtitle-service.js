const assert = require("assert");
const crypto = require("crypto");
const {
    clearGeneratedSubtitleCacheForTests,
    setCachedGeneratedSubtitle,
    setRedisClientForTests,
} = require("../lib/generated-subtitle-cache");
const { getGeneratedSubtitleResponse, getSubtitleOptions } = require("../subtitle-service");

function hashKey(value) {
    return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function extractGeneratedSubtitleKey(url) {
    return url.match(/\/generated-subtitles\/([^.]+)\.vtt$/)[1];
}

describe("subtitle service", function () {
    let previousAddonBaseUrl;
    let previousConsoleLog;
    let previousFetch;
    let previousLogLevel;

    beforeEach(function () {
        previousAddonBaseUrl = process.env.ADDON_BASE_URL;
        previousConsoleLog = console.log;
        previousFetch = global.fetch;
        previousLogLevel = process.env.LOG_LEVEL;
        process.env.ADDON_BASE_URL = "http://127.0.0.1:53100";
        process.env.LOG_LEVEL = "info";
        console.log = () => {};
        clearGeneratedSubtitleCacheForTests();
        setRedisClientForTests(null);
    });

    afterEach(function () {
        console.log = previousConsoleLog;
        global.fetch = previousFetch;
        restoreEnv("ADDON_BASE_URL", previousAddonBaseUrl);
        restoreEnv("LOG_LEVEL", previousLogLevel);
        clearGeneratedSubtitleCacheForTests();
    });

    it("returns a diagnostic response when a generated subtitle is missing", async function () {
        const subtitle = await getGeneratedSubtitleResponse("missing");

        assert.equal(subtitle.cacheControl, "no-store");
        assert.equal(subtitle.diagnostic, true);
        assert.match(subtitle.vtt, /^WEBVTT/);
        assert.match(subtitle.vtt, /Generated subtitle expired or was not found/);
        assert.doesNotMatch(subtitle.vtt, /Details:/);
    });

    it("returns a diagnostic subtitle option when source language subtitles are unavailable", async function () {
        global.fetch = async () => ({
            ok: true,
            text: async () =>
                JSON.stringify({
                    subtitles: [
                        {
                            id: "1",
                            lang: "eng",
                            url: "https://example.com/subtitle.vtt",
                        },
                    ],
                }),
        });

        const response = await getSubtitleOptions({
            config: {
                sourceLang: "de",
                targetLang: "en",
                translationProvider: "googletrans",
            },
            id: "tt123",
            type: "movie",
        });

        assert.equal(response.subtitles.length, 1);
        assert.equal(response.subtitles[0].id, "double-subtitles-diagnostic-no-source-language-subtitles-to-eng");
        assert.equal(response.subtitles[0].lang, "eng");
        assert.match(response.subtitles[0].url, /^http:\/\/127\.0\.0\.1:53100\/diagnostic-subtitles\/.+\.vtt$/);
    });

    it("lets a googletrans request reuse an existing DeepL translation", async function () {
        global.fetch = async () => ({
            ok: true,
            text: async () =>
                JSON.stringify({
                    subtitles: [{ id: "1", lang: "eng", url: "https://example.com/subtitle.vtt" }],
                }),
        });

        const deeplKey = hashKey({
            type: "movie",
            id: "tt123",
            sourceLanguage: "eng",
            targetLanguage: "fre",
            subtitleId: "1",
            subtitleUrl: "https://example.com/subtitle.vtt",
            translationProvider: "deepl",
        });
        await setCachedGeneratedSubtitle(deeplKey, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBonjour\n");

        const response = await getSubtitleOptions({
            config: { sourceLang: "en", targetLang: "fr", translationProvider: "googletrans" },
            id: "tt123",
            type: "movie",
        });

        const subtitle = await getGeneratedSubtitleResponse(extractGeneratedSubtitleKey(response.subtitles[0].url));

        assert.equal(subtitle.diagnostic, false);
        assert.equal(subtitle.vtt, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBonjour\n");
    });

    it("never lets a DeepL request reuse a googletrans translation", async function () {
        global.fetch = async () => ({
            ok: true,
            text: async () =>
                JSON.stringify({
                    subtitles: [{ id: "2", lang: "eng", url: "https://example.com/subtitle2.vtt" }],
                }),
        });

        const googletransKey = hashKey({
            type: "movie",
            id: "tt456",
            sourceLanguage: "eng",
            targetLanguage: "fre",
            subtitleId: "2",
            subtitleUrl: "https://example.com/subtitle2.vtt",
            translationProvider: "googletrans",
        });
        await setCachedGeneratedSubtitle(
            googletransKey,
            "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nShould not be reused\n",
        );

        const response = await getSubtitleOptions({
            config: { sourceLang: "en", targetLang: "fr", translationProvider: "deepl" },
            id: "tt456",
            type: "movie",
        });

        const subtitle = await getGeneratedSubtitleResponse(extractGeneratedSubtitleKey(response.subtitles[0].url));

        assert.equal(subtitle.diagnostic, true);
        assert.doesNotMatch(subtitle.vtt, /Should not be reused/);
    });
});

function restoreEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
        return;
    }

    process.env[name] = value;
}
