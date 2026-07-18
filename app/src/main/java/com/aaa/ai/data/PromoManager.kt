package com.aaa.ai.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Client for the Worker's promo / premium / YouTube-verification endpoints.
 *
 * - [redeem] exchanges a promo code for premium time (first 30 users per code).
 * - [premium] reads the user's current premium status from the Worker.
 * - [ytConnectUrl] builds the per-user Google consent link so the Worker can
 *   verify the user is subscribed to the AAA-FREE-AI channel.
 */
object PromoManager {

    data class RedeemResult(
        val ok: Boolean,
        val premiumDays: Int = 0,
        val premiumUntil: Long = 0,
        val error: String? = null
    )

    data class PremiumStatus(val premium: Boolean, val premiumUntil: Long)

    private fun base(context: Context): String =
        context.getString(com.aaa.ai.R.string.bot_server_url).trimEnd('/')

    /** Redeem a promo code; returns the new premium window on success. */
    suspend fun redeem(context: Context, uid: String, code: String): RedeemResult =
        withContext(Dispatchers.IO) {
            runCatching {
                val conn = URL("${base(context)}/api/promo/redeem").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.setRequestProperty("content-type", "application/json")
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                conn.outputStream.use {
                    it.write(JSONObject().put("uid", uid).put("code", code).toString().toByteArray())
                }
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                val json = JSONObject(body)
                if (json.optBoolean("ok")) {
                    RedeemResult(
                        ok = true,
                        premiumDays = json.optInt("premiumDays"),
                        premiumUntil = json.optLong("premiumUntil")
                    )
                } else {
                    RedeemResult(ok = false, error = json.optString("error", "invalid code"))
                }
            }.getOrDefault(RedeemResult(ok = false, error = "network error"))
        }

    /** Read the user's premium status from the Worker. */
    suspend fun premium(context: Context, uid: String): PremiumStatus? = withContext(Dispatchers.IO) {
        runCatching {
            val conn = URL("${base(context)}/api/premium?uid=$uid").openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()
            val json = JSONObject(body)
            if (json.optBoolean("ok")) PremiumStatus(json.optBoolean("premium"), json.optLong("premiumUntil"))
            else null
        }.getOrNull()
    }

    /** Build the per-user YouTube subscription-verify consent link. */
    fun ytConnectUrl(context: Context, uid: String): String =
        "${base(context)}/api/yt/connect?mode=user&uid=$uid"
}
