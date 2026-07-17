package com.aaa.ai.data.model

/**
 * Result of an API fetch.
 *
 * @param body      raw response text
 * @param isGallery true when the endpoint is a VIP randomized gallery
 * @param rawUrl    best-effort extracted URL (for image rendering), or null
 */
sealed interface ApiResponse {
    data class Success(
        val body: String,
        val isGallery: Boolean,
        val rawUrl: String?
    ) : ApiResponse

    data class Error(val message: String) : ApiResponse
}
