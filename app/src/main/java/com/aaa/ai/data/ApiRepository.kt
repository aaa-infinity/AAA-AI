package com.aaa.ai.data

import android.util.Log
import com.aaa.ai.data.model.ApiResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor
import java.util.concurrent.TimeUnit

/**
 * Performs asynchronous GET requests against the free API catalog.
 * Each call returns the raw response body string (text or image URL),
 * which the UI can render as text or feed into an image loader.
 */
class ApiRepository {

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.BASIC
                }
            )
            .build()
    }

    suspend fun fetchEndpoint(endpoint: ApiEndpoint, value: String): ApiResponse =
        withContext(Dispatchers.IO) {
            try {
                val url = endpoint.buildUrl(ApiEndpoint.BASE_URL, value)
                val request = Request.Builder()
                    .url(url)
                    .header("Accept", "*/*")
                    .build()

                client.newCall(request).execute().use { resp ->
                    val body = resp.body?.string().orEmpty()
                    if (resp.isSuccessful) {
                        ApiResponse.Success(
                            body = body,
                            isGallery = endpoint.isGallery,
                            rawUrl = extractUrl(body)
                        )
                    } else {
                        ApiResponse.Error("HTTP ${resp.code}: ${resp.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e("ApiRepository", "fetch failed", e)
                ApiResponse.Error(e.message ?: "Network error")
            }
        }

    /** Best-effort extraction of a single URL from a response body. */
    private fun extractUrl(body: String): String? {
        val trimmed = body.trim()
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            return trimmed.lines().firstOrNull()?.trim()
        }
        val match = Regex("""https?://[^\s"'>]+""").find(trimmed)
        return match?.value
    }
}
