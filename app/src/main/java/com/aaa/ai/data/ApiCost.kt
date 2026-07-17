package com.aaa.ai.data

/**
 * Point-cost schedule keyed by endpoint id.
 *
 * - Standard AI models (-10): gemini, qwen, gpt3, cohere, bible-ai
 * - Advanced AI models (-30): deepseek-r1, deepseek-v3, gpt-5, copilot, gptlogic, deep-ai, llama-meta
 * - Media Downloaders (-40): ytdl, ytv, ytau, ytplay, yts, ytvi, tiktok2, facebook, igdl, xdl, applemusic, gitclone
 * - Standard Tools & Search (-10): npmsearch, pinterest, lyrics, lyrics2, spotifysearch, tiktoksearch, anisearch, animesearch, tiktokstalk, facts, randomquotes
 * - VIP Studio Tools (-50): ocr, enhance, removebg, tinyurl, ssweb, txt2img, translate
 * - Super VIP Randomized Galleries (-100): waifu, cosplay, nsfw/cuckold, nsfw/pussy, nsfw/blowjob, nsfw/milf, nsfw/yuri
 */
object ApiCost {
    private val STANDARD_AI = setOf("gemini", "qwen", "gpt3", "cohere", "bible-ai")
    private val ADVANCED_AI = setOf(
        "deepseek-r1", "deepseek-v3", "gpt-5", "copilot", "gptlogic", "deep-ai", "llama-meta"
    )
    private val DOWNLOADERS = setOf(
        "ytdl", "ytv", "ytau", "ytplay", "yts", "ytvi",
        "tiktok2", "facebook", "igdl", "xdl", "applemusic", "gitclone"
    )
    private val STANDARD_TOOLS = setOf(
        "npmsearch", "pinterest", "lyrics", "lyrics2", "spotifysearch", "tiktoksearch",
        "anisearch", "animesearch", "tiktokstalk", "facts", "randomquotes"
    )
    private val VIP_STUDIO = setOf(
        "ocr", "enhance", "removebg", "tinyurl", "ssweb", "txt2img", "translate"
    )
    private val SUPER_VIP = setOf("waifu", "cosplay") +
        setOf("nsfw/cuckold", "nsfw/pussy", "nsfw/blowjob", "nsfw/milf", "nsfw/yuri")

    const val STANDARD_AI_COST = 10
    const val ADVANCED_AI_COST = 30
    const val DOWNLOADER_COST = 40
    const val STANDARD_TOOL_COST = 10
    const val VIP_STUDIO_COST = 50
    const val SUPER_VIP_COST = 100

    fun forEndpoint(id: String): Int = when {
        id in STANDARD_AI -> STANDARD_AI_COST
        id in ADVANCED_AI -> ADVANCED_AI_COST
        id in DOWNLOADERS -> DOWNLOADER_COST
        id in STANDARD_TOOLS -> STANDARD_TOOL_COST
        id in VIP_STUDIO -> VIP_STUDIO_COST
        id in SUPER_VIP -> SUPER_VIP_COST
        else -> STANDARD_AI_COST
    }
}
