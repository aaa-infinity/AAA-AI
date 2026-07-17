package com.aaa.ai.data

/**
 * Point-cost schedule keyed by endpoint id, plus a [ResultKind] used by the UI
 * to pick the correct native renderer (chat bubble / image gallery / text card).
 *
 * Cost matrix (per spec):
 * - Standard AI (-10): gemini, qwen, gpt3, cohere, bible-ai
 * - Advanced AI (-30): deepseek-r1, deepseek-v3, gpt-5, copilot
 * - Media Downloaders (-40): ytdl, ytv, ytau, tiktok2, facebook, igdl (+ other downloaders)
 * - Tool Processing (-50): ocr, enhance, removebg, txt2img, translate (+ other studio tools)
 * - Super VIP Randomized Galleries (-100): waifu, cosplay, nsfw variants
 */
enum class ResultKind { CHAT, IMAGE, TEXT }

object ApiCost {
    private val STANDARD_AI = setOf("gemini", "qwen", "gpt3", "cohere", "bible-ai")
    private val ADVANCED_AI = setOf("deepseek-r1", "deepseek-v3", "gpt-5", "copilot")
    private val DOWNLOADERS = setOf(
        "ytdl", "ytv", "ytau", "ytplay", "yts", "ytvi",
        "tiktok2", "facebook", "igdl", "xdl", "applemusic", "gitclone", "anidl"
    )
    private val STUDIO_TOOLS = setOf(
        "ocr", "enhance", "removebg", "tinyurl", "ssweb", "txt2img", "translate"
    )
    private val SUPER_VIP = setOf("waifu", "cosplay") +
        setOf("nsfw/cuckold", "nsfw/pussy", "nsfw/blowjob", "nsfw/milf", "nsfw/yuri")

    // Image-producing endpoints regardless of category.
    private val IMAGE_ENDPOINTS = setOf(
        "waifu", "cosplay", "dalle", "txt2img", "enhance", "removebg", "randomimage"
    ) + SUPER_VIP

    // Text-tool endpoints that get a dedicated text card (OCR / Translate).
    private val TEXT_TOOL_ENDPOINTS = setOf("ocr", "translate")

    const val STANDARD_AI_COST = 10
    const val ADVANCED_AI_COST = 30
    const val DOWNLOADER_COST = 40
    const val STUDIO_TOOL_COST = 50
    const val SUPER_VIP_COST = 100

    fun forEndpoint(id: String): Int = when {
        id in STANDARD_AI -> STANDARD_AI_COST
        id in ADVANCED_AI -> ADVANCED_AI_COST
        id in DOWNLOADERS -> DOWNLOADER_COST
        id in STUDIO_TOOLS -> STUDIO_TOOL_COST
        id in SUPER_VIP -> SUPER_VIP_COST
        else -> STANDARD_AI_COST
    }

    fun kindFor(id: String): ResultKind = when {
        id in IMAGE_ENDPOINTS -> ResultKind.IMAGE
        id in TEXT_TOOL_ENDPOINTS -> ResultKind.TEXT
        else -> ResultKind.CHAT
    }
}
