package com.aaa.ai.data

import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogCompletenessTest {

    private val ids = EndpointCatalog.endpoints.map { it.id }.toSet()

    @Test
    fun includesAllListedAiEndpoints() {
        listOf(
            "llama-meta", "deep-ai", "gpt-5", "copilot", "gptlogic", "deepseek-r1",
            "deepseek-v3", "cohere", "bible-ai", "qwen", "gpt3", "dalle",
            "ai-detector", "gemini"
        ).forEach { assertTrue("missing $it", it in ids) }
    }

    @Test
    fun includesAllListedDownloaders() {
        listOf(
            "xdl", "facebook", "tiktok2", "igdl", "applemusic", "ytdl", "ytplay",
            "ytv", "gitclone", "ytvi", "ytau"
        ).forEach { assertTrue("missing $it", it in ids) }
    }

    @Test
    fun includesAllListedSearchAndTools() {
        listOf(
            "npmsearch", "pinterest", "lyrics", "lyrics2", "spotifysearch",
            "tiktoksearch", "yts", "anisearch", "animesearch", "tiktokstalk",
            "ocr", "randomimage", "enhance", "tinyurl", "ssweb", "txt2img",
            "removebg", "translate", "facts", "randomquotes"
        ).forEach { assertTrue("missing $it", it in ids) }
    }

    @Test
    fun includesAnimeAndNsfw() {
        listOf("anidl", "nsfw/cuckold", "nsfw/pussy", "nsfw/blowjob", "nsfw/milf", "nsfw/yuri")
            .forEach { assertTrue("missing $it", it in ids) }
        assertTrue("waifu" in ids)
        assertTrue("cosplay" in ids)
    }
}
