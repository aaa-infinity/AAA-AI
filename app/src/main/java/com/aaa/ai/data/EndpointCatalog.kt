package com.aaa.ai.data

import com.aaa.ai.data.ApiCategory.AI_CHAT
import com.aaa.ai.data.ApiCategory.DOWNLOADERS
import com.aaa.ai.data.ApiCategory.UTILITIES
import com.aaa.ai.data.ApiCategory.VIP_GALLERIES

/**
 * Full catalog of endpoints, grouped into dashboard categories.
 *
 * The [paramKey] matches each tool's expected query parameter:
 *   q / query / text / url  (see felix-rdx-unlimited-free-apis docs).
 */
object EndpointCatalog {

    val endpoints: List<ApiEndpoint> = listOf(

        // ---------------- AI Chat : Standard (-10) ----------------
        ApiEndpoint("gemini", "Gemini", "gemini", "q", "Prompt", AI_CHAT),
        ApiEndpoint("qwen", "Qwen", "qwen", "q", "Prompt", AI_CHAT),
        ApiEndpoint("gpt3", "GPT-3", "gpt3", "q", "Prompt", AI_CHAT),
        ApiEndpoint("cohere", "Cohere", "cohere", "q", "Prompt", AI_CHAT),
        ApiEndpoint("bible-ai", "Bible AI", "bible-ai", "q", "Topic (e.g. jesus)", AI_CHAT),

        // ---------------- AI Chat : Advanced (-30) ----------------
        ApiEndpoint("deepseek-r1", "DeepSeek R1", "deepseek-r1", "q", "Prompt", AI_CHAT),
        ApiEndpoint("deepseek-v3", "DeepSeek V3", "deepseek-v3", "q", "Prompt", AI_CHAT),
        ApiEndpoint("gpt-5", "GPT-5", "gpt-5", "q", "Prompt", AI_CHAT),
        ApiEndpoint("copilot", "Copilot", "copilot", "text", "Text", AI_CHAT),
        ApiEndpoint("gptlogic", "GPT Logic", "gptlogic", "q", "Question", AI_CHAT),
        ApiEndpoint("deep-ai", "Deep AI", "deep-ai", "query", "Query", AI_CHAT),
        ApiEndpoint("llama-meta", "Llama Meta", "llama-meta", "q", "Prompt", AI_CHAT),

        // ---------------- Downloaders (-40) ----------------
        ApiEndpoint("ytdl", "YouTube DL", "ytdl", "url", "YouTube URL", DOWNLOADERS),
        ApiEndpoint("ytv", "YouTube Video", "ytv", "url", "YouTube URL", DOWNLOADERS),
        ApiEndpoint("ytau", "YouTube Audio", "ytau", "url", "YouTube URL", DOWNLOADERS),
        ApiEndpoint("ytplay", "YouTube Play", "ytplay", "q", "Song name", DOWNLOADERS),
        ApiEndpoint("yts", "YouTube Search", "yts", "q", "Query", DOWNLOADERS),
        ApiEndpoint("ytvi", "YouTube Video Info", "ytvi", "url", "YouTube URL", DOWNLOADERS),
        ApiEndpoint("tiktok2", "TikTok DL", "tiktok2", "url", "TikTok URL", DOWNLOADERS),
        ApiEndpoint("facebook", "Facebook DL", "facebook", "url", "Facebook URL", DOWNLOADERS),
        ApiEndpoint("igdl", "Instagram DL", "igdl", "url", "Instagram URL", DOWNLOADERS),
        ApiEndpoint("xdl", "X (Twitter) DL", "xdl", "url", "X Post URL", DOWNLOADERS),
        ApiEndpoint("applemusic", "Apple Music", "applemusic", "q", "Song name", DOWNLOADERS),
        ApiEndpoint("gitclone", "Git Clone", "gitclone", "url", "Repo URL", DOWNLOADERS),

        // ---------------- Utilities : Standard (-10) ----------------
        ApiEndpoint("npmsearch", "NPM Search", "npmsearch", "q", "Package (baileys)", UTILITIES),
        ApiEndpoint("pinterest", "Pinterest", "pinterest", "q", "Query (anime)", UTILITIES),
        ApiEndpoint("lyrics", "Lyrics", "lyrics", "q", "Song (ozeba)", UTILITIES),
        ApiEndpoint("lyrics2", "Lyrics (alt)", "lyrics2", "q", "Song (ozeba)", UTILITIES),
        ApiEndpoint("spotifysearch", "Spotify Search", "spotifysearch", "q", "Query", UTILITIES),
        ApiEndpoint("tiktoksearch", "TikTok Search", "tiktoksearch", "q", "Query", UTILITIES),
        ApiEndpoint("anisearch", "Anime Search", "anisearch", "q", "Query (naruto)", UTILITIES),
        ApiEndpoint("animesearch", "Anime Search (alt)", "animesearch", "q", "Query (naruto)", UTILITIES),
        ApiEndpoint("tiktokstalk", "TikTok Stalk", "tiktokstalk", "q", "Username", UTILITIES),
        ApiEndpoint("facts", "Facts", "facts", "q", "Topic", UTILITIES),
        ApiEndpoint("randomquotes", "Random Quotes", "randomquotes", "q", "Topic", UTILITIES),

        // ---------------- VIP Studio Tools (-50) ----------------
        ApiEndpoint("ocr", "OCR", "ocr", "url", "Image URL", UTILITIES),
        ApiEndpoint("enhance", "Enhance Image", "enhance", "url", "Image URL", UTILITIES),
        ApiEndpoint("removebg", "Remove BG", "removebg", "url", "Image URL", UTILITIES),
        ApiEndpoint("tinyurl", "TinyURL", "tinyurl", "url", "Long URL", UTILITIES),
        ApiEndpoint("ssweb", "Screenshot Web", "ssweb", "url", "Website URL", UTILITIES),
        ApiEndpoint("txt2img", "Text to Image", "txt2img", "q", "Prompt", UTILITIES),
        ApiEndpoint("translate", "Translate", "translate", "text", "Text", UTILITIES),

        // ---------------- Super VIP Randomized Galleries (-100) ----------------
        ApiEndpoint("waifu", "Waifu", "waifu", "q", "Topic", VIP_GALLERIES, isGallery = true),
        ApiEndpoint("cosplay", "Cosplay", "cosplay", "q", "Topic", VIP_GALLERIES, isGallery = true)
    )

    val categories: List<ApiCategory> = ApiCategory.entries

    fun byCategory(category: ApiCategory): List<ApiEndpoint> =
        endpoints.filter { it.category == category }
}
