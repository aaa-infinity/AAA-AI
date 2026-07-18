package com.aaa.ai.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import org.json.JSONObject
import org.tdlib.tdlib.Client
import org.tdlib.tdlib.TdApi
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

/**
 * Telegram USER-ACCOUNT client (TDLib). Unlike the bot-based login, this logs
 * the app in as a real Telegram account using your my.telegram.org API
 * credentials (BuildConfig.TG_API_ID / TG_API_HASH). After login the account
 * can post to channels, send large files, read/send messages, etc. — with the
 * same 2 GB file limit a normal account has (bots are capped at 50 MB).
 *
 * Login is a one-time, multi-step handshake the USER must complete:
 *   phone -> wait for code -> enter code -> (optional) 2FA password.
 * The resulting session is cached on disk and re-used on next launch.
 *
 * The exported session string is forwarded to the Cloudflare Worker (which
 * stores it as an encrypted backup) but the Worker does NOT act as the user.
 */
object TelegramUserClient {

    private const val TAG = "TgUserClient"
    const val SESSION_VERSION = 1

    sealed interface State {
        data object Closed : State
        data object Loading : State
        data object WaitingPhone : State
        data object WaitingCode : State
        data object WaitingPassword : State
        data class Ready(val userId: Long, val name: String) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Closed)
    val state: StateFlow<State> = _state

    // One-shot events (e.g. "code sent to +1...") for the UI to surface.
    private val _events = MutableSharedFlow<String>(onBufferOverflow = BufferOverflow.DROP_OLDEST, extraBufferCapacity = 16)
    val events: SharedFlow<String> = _events

    private var client: Client? = null
    private var filesDir: File? = null
    private val haveAuth = AtomicBoolean(false)

    fun isEnabled(): Boolean = com.aaa.ai.BuildConfig.TG_API_ID != 0 && com.aaa.ai.BuildConfig.TG_API_HASH.isNotBlank()

    /** Start (or resume) the client. Call before any login step. */
    fun start(context: Context) {
        if (client != null) return
        filesDir = File(context.filesDir, "tdlib")
        filesDir!!.mkdirs()
        _state.value = State.Loading
        client = Client.create({ update -> onUpdate(update) }, { ex -> Log.e(TAG, "TDLib fatal", ex) }, null)
        // Initialize with API credentials.
        client?.send(TdApi.SetTdlibParameters().apply {
            apiId = com.aaa.ai.BuildConfig.TG_API_ID
            apiHash = com.aaa.ai.BuildConfig.TG_API_HASH
            deviceModel = "Super AI App"
            systemVersion = "Android"
            applicationVersion = "2.2.6"
            databaseDirectory = filesDir!!.absolutePath
            useFileDatabase = true
            useChatInfoDatabase = true
            useMessageDatabase = true
            useSecretChats = false
            systemLanguageCode = "en"
            databaseEncryptionKey = "super-ai-tdlib".toByteArray()
        }) { result -> handleResult(result) }
        // Disable verbose logging.
        client?.send(TdApi.SetLogVerbosityLevel().apply { newVerbosityLevel = 1 }) {}
    }

    fun stop() {
        runCatching { client?.send(TdApi.Close()) {} }
        client = null
        _state.value = State.Closed
    }

    /** Step 1: submit phone number (international format, e.g. +1...). */
    fun submitPhone(phone: String) {
        client?.send(TdApi.SetAuthenticationPhoneNumber(phone, null)) { handleResult(it) }
    }

    /** Step 2: submit the SMS/Telegram code. */
    fun submitCode(code: String) {
        client?.send(TdApi.CheckAuthenticationCode(code)) { handleResult(it) }
    }

    /** Step 3 (only if 2FA password requested): submit it. */
    fun submitPassword(password: String) {
        client?.send(TdApi.CheckAuthenticationPassword(password)) { handleResult(it) }
    }

    /** Log out and wipe the local session (requires re-login). */
    fun logOut() {
        client?.send(TdApi.LogOut()) { handleResult(it) }
        filesDir?.deleteRecursively()
        haveAuth.set(false)
        _state.value = State.Closed
    }

    /**
     * Send a local file to a chat (by id) as YOUR Telegram account. Because this
     * is a user account (not a bot) it can send files up to ~2 GB, not the 50 MB
     * bot limit. [chatId] is the Telegram chat/channel id (use the negative id
     * for channels, e.g. -1003932377927 for AAA FREE AI).
     */
    fun sendFile(chatId: Long, filePath: String, caption: String = "") {
        val doc = File(filePath)
        if (!doc.exists()) { _events.tryEmit("File not found: $filePath"); return }
        client?.send(TdApi.SendMessage().apply {
            this.chatId = chatId
            inputMessageContent = TdApi.InputMessageDocument().apply {
                document = TdApi.InputFileLocal(doc.absolutePath)
                this.caption = if (caption.isBlank()) null else TdApi.FormattedText(caption, emptyArray())
            }
        }) { r ->
            if (r is TdApi.Error) _events.tryEmit("Send failed: ${r.message}")
            else _events.tryEmit("File sent to chat $chatId")
        }
    }

    /** Resolve a public @username or t.me link to a chat id (for sending). */
    fun resolveChat(username: String, onResolved: (Long?) -> Unit) {
        client?.send(TdApi.SearchPublicChat(username.replace("@", ""))) { r ->
            if (r is TdApi.Chat) onResolved(r.id) else onResolved(null)
        }
    }

    private fun onUpdate(update: TdApi.Update) {
        when (update) {
            is TdApi.UpdateAuthorizationState -> handleAuthState(update.authorizationState)
            is TdApi.UpdateUser -> {
                if (haveAuth.get()) {
                    val me = update.user
                    _state.value = State.Ready(me.id, me.firstName + " " + (me.lastName ?: ""))
                }
            }
        }
    }

    private fun handleAuthState(s: TdApi.AuthorizationState) {
        when (s) {
            is TdApi.AuthorizationStateWaitTdlibParameters -> _state.value = State.Loading
            is TdApi.AuthorizationStateWaitPhoneNumber -> _state.value = State.WaitingPhone
            is TdApi.AuthorizationStateWaitCode -> {
                _state.value = State.WaitingCode
                _events.tryEmit("Code sent. Enter the login code from Telegram.")
            }
            is TdApi.AuthorizationStateWaitPassword -> {
                _state.value = State.WaitingPassword
                _events.tryEmit("2FA password required.")
            }
            is TdApi.AuthorizationStateReady -> {
                haveAuth.set(true)
                // Export the session string and forward it to the Worker.
                exportSession()
                client?.send(TdApi.GetMe()) { r -> if (r is TdApi.User) _state.value = State.Ready(r.id, r.firstName) }
            }
            is TdApi.AuthorizationStateLoggingOut -> _state.value = State.Closed
            is TdApi.AuthorizationStateClosed -> _state.value = State.Closed
        }
    }

    private fun handleResult(result: TdApi.Object) {
        when (result) {
            is TdApi.Error -> Log.w(TAG, "TD error ${result.code}: ${result.message}")
            // Most intermediate results (ok) are handled via UpdateAuthorizationState.
        }
    }

    /**
     * Export the portable session string and POST it to the Worker so it can be
     * stored encrypted as a backup. The Worker does NOT act as the user.
     */
    private fun exportSession() {
        client?.send(TdApi.GetDatabaseStatistics()) { /* noop */ }
        // TDLib does not expose a single "session string" RPC; the on-disk
        // database directory IS the session. We zip the tdlib dir and upload it
        // (base64) to the Worker for safe-keeping / re-import on a new device.
        filesDir?.let { dir ->
            runCatching {
                val bytes = zipDir(dir)
                val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                kotlinx.coroutines.GlobalScope.launch(Dispatchers.IO) {
                    uploadSession(b64)
                }
            }
        }
    }

    private suspend fun uploadSession(b64: String) = withContext(Dispatchers.IO) {
        runCatching {
            val url = "${contextBase()}/api/tg-session"
            val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            conn.setRequestProperty("x-app-secret", com.aaa.ai.BuildConfig.APP_SHARED_SECRET)
            conn.connectTimeout = 20000
            conn.readTimeout = 20000
            val body = JSONObject().apply {
                put("session", b64)
                put("version", SESSION_VERSION)
            }.toString()
            conn.outputStream.use { it.write(body.toByteArray()) }
            Log.d(TAG, "tg-session upload: ${conn.responseCode}")
            conn.disconnect()
        }.onFailure { Log.w(TAG, "session upload failed", it) }
    }

    private fun contextBase(): String =
        "https://aaa-ai-bot.aaateam.workers.dev"

    private fun zipDir(dir: File): ByteArray {
        val baos = java.io.ByteArrayOutputStream()
        val zos = java.util.zip.ZipOutputStream(baos)
        dir.walkTopDown().filter { it.isFile }.forEach { f ->
            val entry = java.util.zip.ZipEntry(f.relativeTo(dir).path)
            zos.putNextEntry(entry)
            f.inputStream().use { it.copyTo(zos) }
            zos.closeEntry()
        }
        zos.close()
        return baos.toByteArray()
    }
}
