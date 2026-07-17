package com.aaa.ai.data.model

import com.aaa.ai.data.ResultKind

/**
 * Result of an API fetch.
 *
 * @param body      normalized plain text or image URL (JSON wrappers stripped)
 * @param kind      which native renderer to use
 * @param rawUrl    best-effort extracted image URL (for IMAGE results), or null
 */
sealed interface ApiResponse {
    data class Success(
        val body: String,
        val kind: ResultKind,
        val rawUrl: String?
    ) : ApiResponse

    data class Error(val message: String) : ApiResponse
}
