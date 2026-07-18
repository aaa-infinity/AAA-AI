package com.aaa.ai.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Links a Telegram user id to the app's Firebase wallet on the Worker, so that
 * points earned/spent in the Telegram free-AI bot are shared with the app wallet.
 * The Worker stores `tg_link:<chatId> = uid`.
 */
object TelegramLinker {

    private const val TAG = "TelegramLinker"

    private fun base(context: Context): String =
        context.getString(com.aaa.ai.R.string.bot_server_url).trimEnd('/')

    /** Tell the Worker that [chatId] (Telegram user id) owns the app wallet [uid]. */
    suspend fun link(context: Context, chatId: String, uid: String): Boolean =
        withContext(Dispatchers.IO) {
            runCatching {
                val url = URL("${base(context)}/api/link")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.setRequestProperty("content-type", "application/json")
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                val body = JSONObject().apply {
                    put("chatId", chatId)
                    put("uid", uid)
                }.toString()
                conn.outputStream.use { it.write(body.toByteArray()) }
                val code = conn.responseCode
                conn.disconnect()
                code in 200..299
            }.onFailure { Log.e(TAG, "link failed", it) }.getOrDefault(false)
        }
}
