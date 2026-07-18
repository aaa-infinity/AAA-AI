package com.aaa.ai.data

import android.util.Log
import com.aaa.ai.data.model.ApiResponse
import com.aaa.ai.data.model.ParsedResult
import com.aaa.ai.data.ResultKind
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
                        val parsed = ResponseParser.parse(endpoint.id, raw)
                        val kind = ApiCost.kindFor(endpoint.id)
                        val rawUrl = if (parsed is com.aaa.ai.data.model.ParsedResult.Image) parsed.url else null
                        ApiResponse.Success(parsed = parsed, kind = kind, rawUrl = rawUrl)
                    } else {
                        ApiResponse.Error("HTTP ${resp.code}: ${resp.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e("ApiRepository", "fetch failed", e)
                ApiResponse.Error(e.message ?: "Network error")
            }
        }

    /**
     * Demo fallback used when the remote endpoint is unreachable (no network or
     * no backend). Keeps the UI fully usable/offline-friendly by returning a
     * realistic, render-ready payload for the endpoint's result kind.
     */
    fun demoResponse(endpoint: ApiEndpoint, value: String): ApiResponse {
        val kind = ApiCost.kindFor(endpoint.id)
        val parsed: ParsedResult = when (kind) {
            ResultKind.IMAGE -> ParsedResult.Image(
                "https://picsum.photos/seed/${endpoint.id}/640/640"
            )
            ResultKind.TEXT -> ParsedResult.TextBlock(
                title = endpoint.label,
                body = "Demo response for “${value.ifBlank { endpoint.label }}”.\n\n" +
                    "Connect the app to the Ari AI backend (or a live network) to get real results."
            )
            else -> ParsedResult.Chat(
                "Demo reply from ${endpoint.label}: I’m running in offline demo mode, so this is " +
                    "sample text. Wire up the backend or network to chat for real."
            )
        }
        return ApiResponse.Success(parsed = parsed, kind = kind, rawUrl = null)
    }
}
