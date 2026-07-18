package com.aaa.ai.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Direct chat against the Worker's server-side AI router (/api/ask), which uses
 * the owner's provider keys (Gemini / Groq / HuggingFace) with automatic
 * fallback. Lets the in-app chat offer a real model selector instead of only
 * the free felix endpoints.
 */
object ChatApi {

    private const val TAG = "ChatApi"

    enum class Model(val id: String, val label: String) {
        GEMINI("gemini", "Gemini"),
        GROQ("groq", "Groq (Llama)"),
        HF("hf", "HuggingFace");
    }

    private fun base(context: Context): String =
        context.getString(com.aaa.ai.R.string.bot_server_url).trimEnd('/')

    /**
     * Ask the selected model. When the user has supplied their own provider key it
     * is sent in the POST body (never in the URL) so the Worker routes the request
     * through their key first, falling back to the owner key only if absent.
     * Returns the reply text, or null on failure.
     */
    suspend fun ask(context: Context, model: Model, prompt: String): String? =
        withContext(Dispatchers.IO) {
            runCatching {
                val userKey = UserKeys.get(context, model.toProvider())
                val conn = URL("${base(context)}/api/ask").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = 30000
                conn.readTimeout = 30000
                conn.setRequestProperty("content-type", "application/json")
                val payload = JSONObject().apply {
                    put("q", prompt)
                    put("provider", model.id)
                    if (!userKey.isNullOrBlank()) put("key", userKey)
                }.toString()
                conn.doOutput = true
                conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val raw = if (code in 200..299) {
                    conn.inputStream.bufferedReader().use { it.readText() }
                } else {
                    conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                }
                conn.disconnect()
                if (code !in 200..299) {
                    Log.w(TAG, "ask failed ($code): $raw")
                    return@runCatching null
                }
                val json = JSONObject(raw)
                if (json.optBoolean("ok")) json.optString("text").takeIf { it.isNotBlank() } else null
            }.onFailure { Log.e(TAG, "ask exception", it) }.getOrNull()
        }

    private fun Model.toProvider(): UserKeys.Provider = when (this) {
        Model.GEMINI -> UserKeys.Provider.GEMINI
        Model.GROQ -> UserKeys.Provider.GROQ
        Model.HF -> UserKeys.Provider.HF
    }
}
