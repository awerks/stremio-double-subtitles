const assert = require("assert");
const { getSubtitleConfig } = require("../lib/config");
const { translateCues } = require("../lib/translator");

describe("translator retries", function () {
    const originalFetch = global.fetch;

    afterEach(function () {
        global.fetch = originalFetch;
    });

    it("retries a failed DeepL batch before succeeding", async function () {
        const config = getSubtitleConfig({
            deeplApiKey: "secret:fx",
            sourceLang: "en",
            targetLang: "fr",
            translationProvider: "deepl",
        });

        let calls = 0;
        global.fetch = async () => {
            calls += 1;
            if (calls < 3) {
                return {
                    ok: false,
                    status: 503,
                    statusText: "Service Unavailable",
                    async json() {
                        return {};
                    },
                };
            }
            return {
                ok: true,
                async json() {
                    return { translations: [{ text: "Bonjour" }] };
                },
            };
        };

        const translated = await translateCues([{ text: "Hello" }], config);

        assert.equal(calls, 3);
        assert.deepEqual(translated, ["Bonjour"]);
    });

    it("gives up after exhausting retries", async function () {
        const config = getSubtitleConfig({
            deeplApiKey: "secret:fx",
            sourceLang: "en",
            targetLang: "fr",
            translationProvider: "deepl",
        });

        let calls = 0;
        global.fetch = async () => {
            calls += 1;
            return {
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
                async json() {
                    return {};
                },
            };
        };

        await assert.rejects(() => translateCues([{ text: "Hello" }], config));

        assert.equal(calls, 3);
    });
});
