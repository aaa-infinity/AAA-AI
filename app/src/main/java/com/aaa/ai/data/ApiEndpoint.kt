package com.aaa.ai.data

/**
 * A single free API endpoint exposed in the app.
 *
 * @param id            stable identifier (used for cost lookup)
 * @param name          human readable label
 * @param path          path appended to [BASE_URL], e.g. "deepseek-r1"
 * @param paramKey      query parameter key used by this endpoint (q / query / text / url)
 * @param label         input field hint shown to the user
 * @param category      dashboard grouping
 * @param isGallery     true for VIP randomized galleries (raw URL image responses)
 */
data class ApiEndpoint(
    val id: String,
    val name: String,
    val path: String,
    val paramKey: String,
    val label: String,
    val category: ApiCategory,
    val isGallery: Boolean = false
) {
    fun buildUrl(baseUrl: String, value: String): String {
        val encoded = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        return "$baseUrl/$path?$paramKey=$encoded"
    }

    companion object {
        const val BASE_URL = "https://felix-rdx-unlimited-free-apis.vercel.app/api/v1/api"
    }
}

enum class ApiCategory(val title: String) {
    AI_CHAT("AI Chat"),
    DOWNLOADERS("Downloaders"),
    UTILITIES("Utilities"),
    VIP_GALLERIES("VIP Galleries")
}
