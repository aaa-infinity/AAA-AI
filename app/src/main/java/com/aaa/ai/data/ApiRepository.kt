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
}
