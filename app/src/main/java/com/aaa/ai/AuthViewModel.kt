package com.aaa.ai

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aaa.ai.data.AuthRepository
import com.aaa.ai.data.FirestoreBackend
import com.aaa.ai.data.UserProfile
import com.google.firebase.auth.FirebaseUser
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Authentication + profile view model.
 *
 * Exposes a reactive [user] stream (Firebase auth state), sign-in/up/out for
 * email + Google, and ensures a Firestore profile document exists on sign-in.
 */
class AuthViewModel(
    private val auth: AuthRepository,
    private val backend: FirestoreBackend,
    private val appContext: Context
) : ViewModel() {

    val user: StateFlow<FirebaseUser?> = auth.authState()
        .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000), auth.currentUser())

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
        viewModelScope.launch { _events.send(AuthEvent.SignedOut) }
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
    }
}
