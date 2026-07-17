package com.aaa.ai.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Optional client for the Cloudflare Worker bot server.
 *
 * Verifies a Telegram link code issued by @AAA_Login_bot. The Worker holds the
 * bot tokens; the app only ever sends the short-lived code and receives a
 * confirmation. No bot token ever lives in the app.
 */
object TelegramLink {

    /** Call the Worker's /api/verify endpoint for a code. Returns the chatId on success. */
    suspend fun verify(context: Context, code: String): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val base = context.getString(com.aaa.ai.R.string.bot_server_url).trimEnd('/')
            val url = URL("$base/api/verify?code=${code.trim().uppercase()}")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()
            val json = JSONObject(body)
            if (json.optBoolean("ok", false)) {
                json.getString("chatId")
            } else {
                throw IllegalStateException(json.optString("error", "verification failed"))
            }
        }
    }
}
