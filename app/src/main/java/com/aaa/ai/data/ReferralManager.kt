package com.aaa.ai.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Referral rewards: builds a user's personal Telegram invite link and claims any
 * referral points the Worker has queued for them (credited when invited users
 * open the link). The Worker is the source of truth; the app claims and mirrors
 * the reward into the local wallet.
 */
object ReferralManager {

    private const val FREE_BOT = "AAA_Free_Ai_bot"

    data class Pending(val pending: Int, val count: Int)

    /** Personal invite link, e.g. https://t.me/AAA_Free_Ai_bot?start=ref_<chatId>. */
    fun referralLink(chatId: String?): String {
        val id = chatId?.filter { it.isDigit() }.orEmpty()
        return if (id.isBlank()) "https://t.me/$FREE_BOT"
        else "https://t.me/$FREE_BOT?start=ref_$id"
    }

    private fun base(context: Context): String =
        context.getString(com.aaa.ai.R.string.bot_server_url).trimEnd('/')

    /** Read pending referral points and lifetime invite count (no side effects). */
    suspend fun check(context: Context, chatId: String): Pending? = withContext(Dispatchers.IO) {
        runCatching {
            val id = chatId.filter { it.isDigit() }
            val conn = URL("${base(context)}/api/referrals?id=$id").openConnection() as HttpURLConnection
            conn.requestMethod = "GET"; conn.connectTimeout = 15000; conn.readTimeout = 15000
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()
            val json = JSONObject(body)
            if (json.optBoolean("ok")) Pending(json.optInt("pending"), json.optInt("count")) else null
        }.getOrNull()
    }

    /** Atomically claim queued referral points; returns the amount claimed (0 if none). */
    suspend fun claim(context: Context, chatId: String): Int = withContext(Dispatchers.IO) {
        runCatching {
            val id = chatId.filter { it.isDigit() }
            val conn = URL("${base(context)}/api/referrals/claim").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            conn.connectTimeout = 15000; conn.readTimeout = 15000
            conn.outputStream.use { it.write(JSONObject().put("id", id).toString().toByteArray()) }
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()
            val json = JSONObject(body)
            if (json.optBoolean("ok")) json.optInt("claimed") else 0
        }.getOrDefault(0)
    }
}
