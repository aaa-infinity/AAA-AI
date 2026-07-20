package com.aaa.ai

import android.content.Context
import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aaa.ai.data.AuthRepository
import com.aaa.ai.data.FirebaseSync
import com.aaa.ai.data.FirestoreBackend
import com.aaa.ai.data.TelegramAuth
import com.aaa.ai.data.UserProfile
import com.google.firebase.auth.FirebaseUser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Authentication + profile view model.
 *
 * Exposes a reactive [user] stream (Firebase auth state) and sign-in/up/out for
 * email + Google. Telegram login was removed; Super AI uses email and Google.
 */
class AuthViewModel(
    private val auth: AuthRepository,
    private val backend: FirestoreBackend,
    private val appContext: Context
) : ViewModel() {

    val user: StateFlow<FirebaseUser?> = auth.authState()
        .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000), auth.currentUser())

    /** Transient state for the Telegram deep-link verification handshake. */
    private val _tgState = MutableStateFlow<TelegramLoginState>(TelegramLoginState.Idle)
    val tgState: StateFlow<TelegramLoginState> = _tgState

    private val _events = Channel<AuthEvent>(Channel.BUFFERED)
    val events: Flow<AuthEvent> = _events.receiveAsFlow()

    /** Intent to launch Google sign-in (hosted by an Activity). */
    fun googleSignInIntent(): Intent = auth.googleSignInIntent()

    fun signInWithGoogle(data: Intent?) {
        viewModelScope.launch {
            _events.send(AuthEvent.Busy(true))
            auth.signInWithGoogle(data)
                .onSuccess { onSignedIn(it) }
                .onFailure { _events.send(AuthEvent.Error(it.message ?: "Google sign-in failed")) }
            _events.send(AuthEvent.Busy(false))
        }
    }

    fun signIn(email: String, password: String) {
        viewModelScope.launch {
            _events.send(AuthEvent.Busy(true))
            auth.signInWithEmail(email, password)
                .onSuccess { onSignedIn(it) }
                .onFailure { _events.send(AuthEvent.Error(it.message ?: "Sign-in failed")) }
            _events.send(AuthEvent.Busy(false))
        }
    }

    fun signUp(email: String, password: String) {
        viewModelScope.launch {
            _events.send(AuthEvent.Busy(true))
            auth.signUpWithEmail(email, password)
                .onSuccess { onSignedIn(it) }
                .onFailure { _events.send(AuthEvent.Error(it.message ?: "Sign-up failed")) }
            _events.send(AuthEvent.Busy(false))
        }
    }

    fun signOut() {
        auth.signOut()
        TelegramAuth.clear(appContext)
        _tgState.value = TelegramLoginState.Idle
        viewModelScope.launch {
            _events.send(AuthEvent.SignedOut)
        }
    }

    /**
     * Telegram deep-link login: generate a code, persist it, open the Telegram
     * bot, then poll the worker until the code is verified.
     */
    fun startTelegramLogin() {
        val code = TelegramAuth.generateCode()
        _tgState.value = TelegramLoginState.Opening(code)
        viewModelScope.launch {
            TelegramAuth.savePending(appContext, code)
            withContext(Dispatchers.Main) {
                appContext.startActivity(
                    TelegramAuth.botDeepLink(code).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
            runPoll(code)
        }
    }

    fun resumeTelegramLogin() {
        if (_tgState.value is TelegramLoginState.Polling ||
            _tgState.value is TelegramLoginState.Verified) return
        viewModelScope.launch {
            val code = TelegramAuth.loadPending(appContext)
            if (code.isNotBlank()) {
                _tgState.value = TelegramLoginState.Polling(code)
                runPoll(code)
            }
        }
    }

    private suspend fun runPoll(code: String) {
        _tgState.value = TelegramLoginState.Polling(code)
        val server = appContext.getString(com.aaa.ai.R.string.bot_server_url)
        val profile = TelegramAuth.poll(appContext, code, server) { _tgState.value = TelegramLoginState.Polling(code) }
        if (profile != null) {
            val chatId = profile.id.ifBlank {
                com.aaa.ai.data.TelegramAuth.load(appContext).chatId
            }
            TelegramAuth.save(appContext, chatId, profile)
            _tgState.value = TelegramLoginState.Verified(chatId)
            _events.send(AuthEvent.TelegramVerified(chatId))
        } else {
            _tgState.value = TelegramLoginState.Failed("Verification timed out. Tap the button again.")
        }
    }

    private suspend fun onSignedIn(user: FirebaseUser) {
        runCatching { backend.ensureProfile(user) }
        // Mirror the Firebase user into the Cloudflare -> Supabase + D1 backends.
        runCatching { FirebaseSync.sync(appContext, user) }
        viewModelScope.launch {
            UserProfile.profileFlow(appContext).collect { p ->
                if (p.name.isBlank() && !user.displayName.isNullOrBlank()) {
                    UserProfile.setName(appContext, user.displayName!!)
                }
            }
        }
        _events.send(AuthEvent.SignedIn(user))
    }

    sealed interface AuthEvent {
        data class SignedIn(val user: FirebaseUser) : AuthEvent
        data object SignedOut : AuthEvent
        data class Error(val message: String) : AuthEvent
        data class Busy(val value: Boolean) : AuthEvent
        data class TelegramVerified(val chatId: String) : AuthEvent
    }

    /** State machine for the Telegram deep-link verification handshake. */
    sealed interface TelegramLoginState {
        data object Idle : TelegramLoginState
        data class Opening(val code: String) : TelegramLoginState
        data class Polling(val code: String) : TelegramLoginState
        data class Verified(val chatId: String) : TelegramLoginState
        data class Failed(val message: String) : TelegramLoginState
    }
}
