package com.aaa.ai.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiCostTest {

    @Test
    fun standardAiCosts10() {
        listOf("gemini", "qwen", "gpt3", "cohere", "bible-ai").forEach {
            assertEquals(10, ApiCost.forEndpoint(it))
        }
    }

    @Test
    fun advancedAiCosts30() {
        listOf("deepseek-r1", "deepseek-v3", "gpt-5", "copilot", "gptlogic", "deep-ai", "llama-meta")
            .forEach { assertEquals(30, ApiCost.forEndpoint(it)) }
    }

    @Test
    fun downloadersCost40() {
        listOf("ytdl", "ytv", "ytau", "ytplay", "yts", "ytvi", "tiktok2", "facebook", "igdl", "xdl", "applemusic", "gitclone")
            .forEach { assertEquals(40, ApiCost.forEndpoint(it)) }
    }

    @Test
    fun standardToolsCost10() {
        listOf("npmsearch", "pinterest", "lyrics", "lyrics2", "spotifysearch", "tiktoksearch", "anisearch", "animesearch", "tiktokstalk", "facts", "randomquotes")
            .forEach { assertEquals(10, ApiCost.forEndpoint(it)) }
    }

    @Test
    fun vipStudioCost50() {
        listOf("ocr", "enhance", "removebg", "tinyurl", "ssweb", "txt2img", "translate")
            .forEach { assertEquals(50, ApiCost.forEndpoint(it)) }
    }

    @Test
    fun superVipCost100() {
        listOf("waifu", "cosplay", "nsfw/cuckold", "nsfw/pussy", "nsfw/blowjob", "nsfw/milf", "nsfw/yuri")
            .forEach { assertEquals(100, ApiCost.forEndpoint(it)) }
    }
}
