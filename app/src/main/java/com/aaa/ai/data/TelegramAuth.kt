package com.aaa.ai.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/**
 * Self-contained Telegram login backed by our Cloudflare Worker.
 *
 * Flow:
 *  1. App generates an 8-char code and persists it as "pending".
 *  2. App opens the Telegram bot deep link  t.me/<bot>?start=verify_<code>.
 *  3. The Worker's bot receives /start verify_<code>, knows the Telegram user,
 *     and stores verify:<code> -> {chatId, profile} in KV.
 *  4. App polls GET /api/verify?code=<code> until it returns ok:true.
 *  5. The verified session (chatId + profile) is persisted locally and the app
 *     treats the Telegram chat id as the signed-in account.
 */
object TelegramAuth {

    data class Profile(
        val id: String = "",
        val username: String = "",
        val firstName: String = "",
        val lastName: String = "",
        val photoUrl: String = "",
        val isPremium: Boolean = false,
        val languageCode: String = "",
        val phone: String = ""
    ) {
        val displayName: String
            get() = listOf(firstName, lastName).filter { it.isNotBlank() }.joinToString(" ")
                .ifBlank { username.ifBlank { id } }
    }

    data class Session(
        val chatId: String = "",
        val profile: Profile = Profile(),
        val verified: Boolean = false
    )

    private const val PREFS = "tg_session"
    private const val KEY_CHAT = "chat_id"
    private const val KEY_PROFILE = "profile"
    private const val KEY_PENDING = "pending_code"

    private val _session = MutableStateFlow(Session())
    val sessionFlow: StateFlow<Session> = _session.asStateFlow()

    /** Refresh the in-memory session from local storage (call on app start). */
    fun refresh(ctx: Context) {
        _session.value = load(ctx)
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(ctx: Context?): Session {
        if (ctx == null) return _session.value
        val p = prefs(ctx)
        val chat = p.getString(KEY_CHAT, "") ?: ""
        if (chat.isBlank()) return Session()
        val profile = runCatching {
            val j = JSONObject(p.getString(KEY_PROFILE, "{}"))
            Profile(
                id = j.optString("id", chat),
                username = j.optString("username"),
                firstName = j.optString("firstName"),
                lastName = j.optString("lastName"),
                photoUrl = j.optString("photoUrl"),
                isPremium = j.optBoolean("isPremium"),
                languageCode = j.optString("languageCode"),
                phone = j.optString("phone")
            )
        }.getOrDefault(Profile(id = chat))
        return Session(chatId = chat, profile = profile, verified = true)
    }

    fun save(ctx: Context, chatId: String, profile: Profile) {
        prefs(ctx).edit()
            .putString(KEY_CHAT, chatId)
            .putString(KEY_PROFILE, JSONObject().apply {
                put("id", profile.id.ifBlank { chatId })
                put("username", profile.username)
                put("firstName", profile.firstName)
                put("lastName", profile.lastName)
                put("photoUrl", profile.photoUrl)
                put("isPremium", profile.isPremium)
                put("languageCode", profile.languageCode)
                put("phone", profile.phone)
            }.toString())
            .remove(KEY_PENDING)
            .apply()
        _session.value = Session(chatId = chatId, profile = profile, verified = true)
    }

    fun savePending(ctx: Context, code: String) {
        prefs(ctx).edit().putString(KEY_PENDING, code).apply()
    }

    fun loadPending(ctx: Context): String = prefs(ctx).getString(KEY_PENDING, "") ?: ""

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
        _session.value = Session()
    }

    fun generateCode(): String =
        (1..8).map { "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[(Math.random() * 32).toInt()] }.joinToString("")

    /**
     * Submit a link code (from the login bot) to the worker and, on success,
     * persist the verified Telegram session locally. Returns true if linked.
     */
    suspend fun submitCode(ctx: Context, code: String, appUid: String = ""): Boolean {
        val base = (ctx.getString(com.aaa.ai.R.string.bot_server_url) ?: "https://aaa-ai-bot.aaateam.workers.dev").trimEnd('/')
        return runCatching {
            val url = "$base/api/verify?code=${java.net.URLEncoder.encode(code, "UTF-8")}"
            val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()
            val j = JSONObject(text)
            if (j.optBoolean("ok")) {
                val chatId = j.optString("chatId")
                val prof = j.optJSONObject("profile")
                val profile = if (prof != null) Profile(
                    id = prof.optString("id", chatId),
                    username = prof.optString("username"),
                    firstName = prof.optString("firstName"),
                    lastName = prof.optString("lastName"),
                    photoUrl = prof.optString("photoUrl"),
                    isPremium = prof.optBoolean("isPremium"),
                    languageCode = prof.optString("languageCode"),
                    phone = prof.optString("phone")
                ) else Profile(id = chatId)
                save(ctx, chatId, profile)
                // Link the Telegram id to the (possibly app-only) account uid so
                // the store can show both the Telegram id and the account uid.
                if (appUid.isNotBlank()) {
                    runCatching {
                        val link = java.net.URL("$base/api/link")
                        val c2 = link.openConnection() as java.net.HttpURLConnection
                        c2.requestMethod = "POST"
                        c2.connectTimeout = 10000
                        c2.readTimeout = 10000
                        c2.setRequestProperty("content-type", "application/json")
                        c2.doOutput = true
                        c2.outputStream.write(
                            JSONObject().put("chatId", chatId).put("uid", appUid).toString().toByteArray()
                        )
                        c2.inputStream.bufferedReader().use { it.readText() }
                        c2.disconnect()
                    }
                }
                true
            } else false
        }.getOrDefault(false)
    }

    fun botDeepLink(code: String, bot: String = "AAA_Login_bot"): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("https://t.me/$bot?start=verify_$code"))

    /**
     * Poll the worker until the code is verified. Returns the profile on success
     * or null on timeout/expiry. One-time code is consumed by the worker.
     */
    suspend fun poll(
        ctx: Context,
        code: String,
        serverUrl: String,
        onState: (String) -> Unit = {}
    ): Profile? {
        val base = serverUrl.trimEnd('/')
        repeat(40) { i ->
            onState("Polling")
            runCatching {
                val url = "$base/api/verify?code=$code"
                val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 10000
                conn.readTimeout = 10000
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                val j = JSONObject(text)
                if (j.optBoolean("ok")) {
                    val chatId = j.optString("chatId")
                    val prof = j.optJSONObject("profile")
                    val profile = if (prof != null) Profile(
                        id = prof.optString("id", chatId),
                        username = prof.optString("username"),
                        firstName = prof.optString("firstName"),
                        lastName = prof.optString("lastName"),
                        photoUrl = prof.optString("photoUrl"),
                        isPremium = prof.optBoolean("isPremium"),
                        languageCode = prof.optString("languageCode"),
                        phone = prof.optString("phone")
                    ) else Profile(id = chatId)
                    return profile
                }
            }
            delay(3000)
        }
        return null
    }
}
