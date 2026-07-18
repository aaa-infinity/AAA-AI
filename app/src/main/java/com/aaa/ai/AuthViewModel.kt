package com.aaa.ai

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aaa.ai.data.AuthRepository
import com.aaa.ai.data.FirestoreBackend
import com.aaa.ai.data.TelegramAuthSession
import com.aaa.ai.data.TelegramDeepLinkAuth
import com.aaa.ai.data.TelegramVerifyPoller
import com.aaa.ai.data.UserProfile
import com.google.firebase.auth.FirebaseUser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Authentication + profile view model.
 *
 * Exposes a reactive [user] stream (Firebase auth state), sign-in/up/out for
 * email + Google, and a Telegram deep-link login flow that generates a secure
 * token, opens the Telegram client, and polls the backend until verified.
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
            auth.signInWithGoogle(data)
                .onSuccess { onSignedIn(it) }
                .onFailure { _events.send(AuthEvent.Error(it.message ?: "Google sign-in failed")) }
        }
    }

    fun signIn(email: String, password: String) {
        viewModelScope.launch {
            auth.signInWithEmail(email, password)
                .onSuccess { onSignedIn(it) }
                .onFailure { _events.send(AuthEvent.Error(it.message ?: "Sign-in failed")) }
        }
    }

    fun signUp(email: String, password: String) {
        viewModelScope.launch {
            auth.signUpWithEmail(email, password)
                .onSuccess { onSignedIn(it) }
                .onFailure { _events.send(AuthEvent.Error(it.message ?: "Sign-up failed")) }
        }
    }

    fun signOut() {
        auth.signOut()
        viewModelScope.launch {
            TelegramAuthSession.clear(appContext)
            _tgState.value = TelegramLoginState.Idle
            _events.send(AuthEvent.SignedOut)
        }
    }

    /**
     * Telegram deep-link login.
     *
     * 1. Generate an 8-char token and persist it as pending.
     * 2. Open the Telegram client to the bot with `start=verify_<token>`.
     * 3. Start a 3s polling coroutine against the backend; on success, persist
     *    the verified session and emit [TelegramLoginState.Verified].
     */
    fun startTelegramLogin() {
        val token = TelegramDeepLinkAuth.generateToken()
        _tgState.value = TelegramLoginState.Opening(token)
        viewModelScope.launch {
            TelegramAuthSession.savePending(appContext, token)
            withContext(Dispatchers.Main) {
                TelegramDeepLinkAuth.launch(appContext, token)
            }
            _tgState.value = TelegramLoginState.Polling(token)
            val result = TelegramVerifyPoller.poll(appContext, token)
            if (result != null && isActive) {
                TelegramAuthSession.saveVerified(appContext, token, result.chatId, result.profile)
                _tgState.value = TelegramLoginState.Verified(result.chatId)
                _events.send(AuthEvent.TelegramVerified(result.chatId))
            } else if (isActive) {
                _tgState.value = TelegramLoginState.Failed("Verification timed out. Tap retry.")
            }
        }
    }

    fun resetTelegramLogin() {
        _tgState.value = TelegramLoginState.Idle
    }

    private suspend fun onSignedIn(user: FirebaseUser) {
        runCatching { backend.ensureProfile(user) }
        // Seed local lifetime display name from auth if empty
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
        data class TelegramVerified(val chatId: String) : AuthEvent
    }

    /** State machine for the Telegram deep-link verification handshake. */
    sealed interface TelegramLoginState {
        data object Idle : TelegramLoginState
        data class Opening(val token: String) : TelegramLoginState
        data class Polling(val token: String) : TelegramLoginState
        data class Verified(val chatId: String) : TelegramLoginState
        data class Failed(val message: String) : TelegramLoginState
    }
}
