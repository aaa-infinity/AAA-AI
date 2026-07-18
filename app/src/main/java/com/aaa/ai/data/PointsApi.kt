package com.aaa.ai.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Server-authoritative points ledger.
 *
 * All point mutations (earn / spend) go through the Cloudflare Worker's guarded
 * `/api/points/add` endpoint, which writes to D1 (the authoritative wallet) and
 * mirrors to Supabase. The Android app NEVER writes `points` directly to
 * Firestore — Firestore only mirrors the balance for display (enforced by
 * firestore.rules). This prevents a client from self-crediting points.
 */
object PointsApi {

    private const val TAG = "PointsApi"

    private fun base(context: Context): String =
        context.getString(com.aaa.ai.R.string.bot_server_url).trimEnd('/')

    /**
     * Credit [amount] points to [uid] on the server (D1 authoritative).
     * Returns the new balance, or null on failure.
     */
    suspend fun addPoints(context: Context, uid: String, amount: Int, reason: String): Int? =
        mutate(context, uid, amount, reason)

    /**
     * Spend [amount] points for [uid] on the server.
     * Returns the new balance on success, or null if the spend failed
     * (e.g. insufficient balance) or the request errored.
     */
    suspend fun spendPoints(context: Context, uid: String, amount: Int, reason: String): Int? =
        mutate(context, uid, -amount, reason)

    /**
     * Read the authoritative balance for [uid] from the server (D1).
     * Returns the balance, or null on failure.
     */
    suspend fun getBalance(context: Context, uid: String): Int? = withContext(Dispatchers.IO) {
        runCatching {
            val conn = URL("${base(context)}/api/points/get?uid=${java.net.URLEncoder.encode(uid, "UTF-8")}")
                .openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            val code = conn.responseCode
            val raw = if (code in 200..299) {
                conn.inputStream.bufferedReader().use { it.readText() }
            } else {
                conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
            }
            conn.disconnect()
            if (code !in 200..299) {
                Log.w(TAG, "points/get failed ($code): $raw")
                return@runCatching null
            }
            val json = JSONObject(raw)
            if (json.optBoolean("ok")) json.optInt("points", 0) else null
        }.onFailure { Log.e(TAG, "points/get exception", it) }.getOrNull()
    }

    private suspend fun mutate(context: Context, uid: String, amount: Int, reason: String): Int? =
        withContext(Dispatchers.IO) {
            runCatching {
                val url = URL("${base(context)}/api/points/add")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.setRequestProperty("content-type", "application/json")
                conn.setRequestProperty("x-app-secret", com.aaa.ai.BuildConfig.APP_SHARED_SECRET)
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                val body = JSONObject().apply {
                    put("uid", uid)
                    put("amount", amount)
                    put("reason", reason)
                }.toString()
                conn.outputStream.use { it.write(body.toByteArray()) }
                val code = conn.responseCode
                val raw = if (code in 200..299) {
                    conn.inputStream.bufferedReader().use { it.readText() }
                } else {
                    conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                }
                conn.disconnect()
                if (code !in 200..299) {
                    Log.w(TAG, "points/add failed ($code): $raw")
                    return@runCatching null
                }
                val json = JSONObject(raw)
                if (json.optBoolean("ok")) json.optInt("points", -1).let { if (it < 0) null else it }
                else null
            }.onFailure { Log.e(TAG, "points/add exception", it) }.getOrNull()
        }
}
