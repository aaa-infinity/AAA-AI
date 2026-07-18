package com.aaa.ai.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.coroutineContext

/**
 * Coroutine polling loop that checks the backend for verification of a token.
 *
 * Polls the Cloudflare Worker `/api/verify?code=verify_<token>` endpoint once
 * every 3 seconds. The Worker holds the bot-issued mapping (the bot token stays
 * server-side; the app only ever sends the short-lived token). Stops safely as
 * soon as verification succeeds, the coroutine is cancelled, or the timeout lapses.
 */
object TelegramVerifyPoller {

    private const val POLL_INTERVAL_MS = 3000L
    private const val MAX_DURATION_MS = 5 * 60 * 1000L // 5 min safety cap

    data class Result(val chatId: String, val profile: TelegramProfile?)

    /**
     * Poll until verified or cancelled. Returns the chatId + profile on success, null otherwise.
     * Safe to cancel: the loop checks [coroutineContext.isActive] every iteration.
     */
    suspend fun poll(context: Context, token: String): Result? = withContext(Dispatchers.IO) {
        val base = context.getString(com.aaa.ai.R.string.bot_server_url).trimEnd('/')
        val code = "verify_" + token.uppercase()
        val deadline = System.currentTimeMillis() + MAX_DURATION_MS
        while (coroutineContext.isActive && System.currentTimeMillis() < deadline) {
            val result = withTimeoutOrNull(POLL_INTERVAL_MS - 500) { verifyOnce(base, code) }
            if (result != null) return@withContext result
            delay(POLL_INTERVAL_MS)
        }
        null
    }

    private fun verifyOnce(base: String, code: String): Result? = runCatching {
        val url = URL("$base/api/verify?code=${code}")
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.connectTimeout = 15000
        conn.readTimeout = 15000
        val body = conn.inputStream.bufferedReader().use { it.readText() }
        conn.disconnect()
        val json = JSONObject(body)
        if (json.optBoolean("ok", false)) {
            Result(json.getString("chatId"), TelegramProfile.fromJson(json.optJSONObject("profile")))
        } else null
    }.getOrNull()
}
