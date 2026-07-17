package com.aaa.ai.data.model

import com.aaa.ai.data.ResultKind

/**
 * A structured, UI-ready representation of an API result.
 *
 * The repository never hands raw JSON strings to the UI — it maps every
 * response into one of these sealed types so composables render native
 * components (chat bubbles, image cards, text blocks, result lists).
 */
sealed interface ParsedResult {
    /** Conversational AI text (rendered as chat bubbles). */
    data class Chat(val text: String) : ParsedResult

    /** A single image URL (rendered with Coil + save overlay). */
    data class Image(val url: String) : ParsedResult

    /** A formatted typography block (lyrics, facts, quotes, OCR). */
    data class TextBlock(val title: String?, val body: String) : ParsedResult

    /** A structured list of cards (search results: npm, pinterest, tiktok...). */
    data class List(val items: kotlin.collections.List<ResultItem>) : ParsedResult
}

/**
 * One card in a [ParsedResult.List]. Every field is optional so a single
 * generic mapper can handle npmsearch / pinterest / tiktoksearch / etc.
 */
data class ResultItem(
    val title: String? = null,
    val subtitle: String? = null,
    val body: String? = null,
    val thumbnail: String? = null,
    val url: String? = null
)

/**
 * Result of an API fetch.
 *
 * @param parsed    structured, render-ready payload (never raw JSON)
 * @param kind      which native renderer to use
 * @param rawUrl    best-effort extracted image URL (for IMAGE results), or null
 */
sealed interface ApiResponse {
    data class Success(
        val parsed: ParsedResult,
        val kind: ResultKind,
        val rawUrl: String?
    ) : ApiResponse

    data class Error(val message: String) : ApiResponse
}
