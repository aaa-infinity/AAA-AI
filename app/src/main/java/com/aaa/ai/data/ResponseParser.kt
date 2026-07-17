package com.aaa.ai.data

import com.aaa.ai.data.model.ParsedResult
import com.aaa.ai.data.model.ResultItem
import org.json.JSONArray
import org.json.JSONObject

/**
 * Maps a raw endpoint response into a structured [ParsedResult].
 *
 * Strategy:
 *  - Image-producing endpoints -> [ParsedResult.Image] (extract first http url).
 *  - Known structured endpoints (searches) -> [ParsedResult.List] of [ResultItem].
 *  - Known text endpoints (lyrics/facts/quotes/ocr) -> [ParsedResult.TextBlock].
 *  - Chat/unknown -> [ParsedResult.Chat] (plain text, JSON wrappers stripped).
 *
 * Everything degrades gracefully: if a JSON shape is unexpected we fall back to
 * a readable text representation rather than dumping raw brackets.
 */
object ResponseParser {

    fun parse(endpointId: String, raw: String): ParsedResult {
        val trimmed = raw.trim()
        val isJson = trimmed.startsWith("{") || trimmed.startsWith("[")

        return when {
            ApiCost.kindFor(endpointId) == ResultKind.IMAGE ->
                ParsedResult.Image(extractFirstUrl(stripWrapper(trimmed)) ?: trimmed)

            endpointId in TEXT_BLOCK_ENDPOINTS ->
                ParsedResult.TextBlock(titleFor(endpointId), stripWrapper(trimmed))

            endpointId in LIST_ENDPOINTS && isJson ->
                parseList(endpointId, trimmed) ?: ParsedResult.Chat(stripWrapper(trimmed))

            else -> ParsedResult.Chat(stripWrapper(trimmed))
        }
    }

    /** Strip common wrapper keys and return the inner readable text. */
    private fun stripWrapper(body: String): String {
        val trimmed = body.trim()
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed
        return try {
            val obj = if (trimmed.startsWith("[")) {
                val arr = JSONArray(trimmed)
                if (arr.length() > 0) arr[0] else null
            } else {
                JSONObject(trimmed)
            }
            if (obj is JSONObject) {
                for (key in listOf("result", "response", "url", "image", "imageUrl", "output", "text", "data", "answer")) {
                    if (obj.has(key)) return obj.get(key).toString().trim('"')
                }
            }
            trimmed
        } catch (_: Exception) {
            trimmed
        }
    }

    private fun parseList(endpointId: String, body: String): ParsedResult? {
        return try {
            val roots = if (body.startsWith("[")) {
                val arr = JSONArray(body)
                (0 until arr.length()).mapNotNull { i -> arr.opt(i) as? JSONObject }
            } else {
                val obj = JSONObject(body)
                // common patterns: { data: [...] }, { results: [...] }, { result: [...] }
                val arr = when {
                    obj.has("data") && obj.get("data") is JSONArray -> obj.getJSONArray("data")
                    obj.has("results") && obj.get("results") is JSONArray -> obj.getJSONArray("results")
                    obj.has("result") && obj.get("result") is JSONArray -> obj.getJSONArray("result")
                    obj.has("items") && obj.get("items") is JSONArray -> obj.getJSONArray("items")
                    else -> null
                } ?: return ParsedResult.List(emptyList())
                (0 until arr.length()).mapNotNull { i -> arr.opt(i) as? JSONObject }
            }
            val items = roots.mapNotNull { toItem(endpointId, it) }
            ParsedResult.List(items)
        } catch (_: Exception) {
            null
        }
    }

    private fun toItem(endpointId: String, obj: JSONObject): ResultItem? {
        // Generic field probing — tolerant to many shapes.
        val pick = { keys: List<String> ->
            keys.firstNotNullOfOrNull { k -> obj.optString(k).takeIf { v -> v.isNotBlank() } }
        }
        val title = pick(listOf("name", "title", "package", "username", "user", "track", "song", "query", "full_name"))
        val subtitle = pick(listOf("version", "ver", "artist", "author", "owner", "type", "kind"))
        val body = pick(listOf("description", "desc", "text", "body", "summary", "caption", "lyrics", "about"))
        val thumb = pick(listOf("thumbnail", "image", "img", "avatar", "photo", "cover", "url"))
        val url = pick(listOf("url", "link", "href", "web", "download"))
        // skip empty objects
        if (title == null && subtitle == null && body == null && thumb == null && url == null) return null
        return ResultItem(title = title, subtitle = subtitle, body = body, thumbnail = thumb, url = url)
    }

    private fun extractFirstUrl(body: String): String? {
        val trimmed = body.trim()
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            return trimmed.lines().firstOrNull()?.trim()
        }
        return Regex("""https?://[^\s"'>]+""").find(trimmed)?.value
    }

    private fun titleFor(endpointId: String): String? = when (endpointId) {
        "lyrics", "lyrics2" -> "Lyrics"
        "facts" -> "Fact"
        "randomquotes" -> "Quote"
        "ocr" -> "Extracted Text"
        "translate" -> "Translation"
        else -> null
    }

    private val TEXT_BLOCK_ENDPOINTS = setOf(
        "lyrics", "lyrics2", "facts", "randomquotes", "ocr", "translate"
    )

    private val LIST_ENDPOINTS = setOf(
        "npmsearch", "pinterest", "lyrics", "lyrics2", "spotifysearch",
        "tiktoksearch", "anisearch", "animesearch", "tiktokstalk", "facts", "randomquotes"
    )
}
