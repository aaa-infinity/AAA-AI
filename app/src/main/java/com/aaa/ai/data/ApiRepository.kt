package com.aaa.ai.data

import android.util.Log
import com.aaa.ai.data.model.ApiResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Performs asynchronous GET requests against the free API catalog.
 * Normalizes the response (strips common JSON wrappers) and emits a [ResultKind]
 * so the UI can pick the correct native renderer.
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
                    val raw = resp.body?.string().orEmpty()
                    if (resp.isSuccessful) {
                        val normalized = normalize(raw)
                        val kind = ApiCost.kindFor(endpoint.id)
                        ApiResponse.Success(
                            body = normalized,
                            kind = kind,
                            rawUrl = if (kind == ResultKind.IMAGE) extractUrl(normalized) else null
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

    /** Strip common JSON wrappers; return the inner text/url or the original body. */
    private fun normalize(body: String): String {
        val trimmed = body.trim()
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
                val obj = if (trimmed.startsWith("[")) {
                    val arr = org.json.JSONArray(trimmed)
                    if (arr.length() > 0) arr.get(0) else null
                } else {
                    JSONObject(trimmed)
                }
                if (obj is JSONObject) {
                    for (key in listOf("result", "response", "url", "image", "imageUrl", "output", "text", "data")) {
                        if (obj.has(key)) {
                            val v = obj.get(key)
                            return v.toString().trim('"')
                        }
                    }
                }
            } catch (_: Exception) {
                // not valid JSON we can simplify; fall through
            }
        }
        return trimmed
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
