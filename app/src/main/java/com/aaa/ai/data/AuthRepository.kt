package com.aaa.ai.data

import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.EmailAuthProvider
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * Wraps Firebase Authentication: email/password + Google sign-in.
 * Google uses the auto-generated web client id supplied by google-services.json
 * (R.string.default_web_client_id).
 */
class AuthRepository(private val context: Context) {

    private val auth: FirebaseAuth = FirebaseAuth.getInstance()

    private val googleClient: GoogleSignInClient by lazy {
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(context.getString(com.aaa.ai.R.string.default_web_client_id))
            .requestEmail()
            .build()
        GoogleSignIn.getClient(context, gso)
    }

    /** Reactive auth state: emits the current user (or null) on every change. */
    fun authState(): Flow<FirebaseUser?> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { trySend(it.currentUser) }
        auth.addAuthStateListener(listener)
        trySend(auth.currentUser)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    fun currentUser(): FirebaseUser? = auth.currentUser

    /** Intent to launch the Google sign-in sheet. */
    fun googleSignInIntent(): Intent = googleClient.signInIntent

    /** Build a credential from the Google sign-in activity result. */
    fun googleCredentialFrom(data: Intent?): AuthCredential? {
        return try {
            val task = GoogleSignIn.getSignedInAccountFromIntent(data)
            val account = task.getResult(ApiException::class.java)
            GoogleAuthProvider.getCredential(account.idToken, null)
        } catch (e: Exception) {
            null
        }
    }

    private suspend fun linkOrSignIn(credential: AuthCredential): AuthResult {
        // If an anonymous/email user is signed in, link; otherwise sign in.
        val user = auth.currentUser
        return if (user != null && user.isAnonymous) {
            user.linkWithCredential(credential).await()
        } else {
            auth.signInWithCredential(credential).await()
        }
    }

    suspend fun signInWithGoogle(data: Intent?): Result<FirebaseUser> {
        val credential = googleCredentialFrom(data) ?: return Result.failure(
            IllegalArgumentException("Google sign-in failed")
        )
        return runCatching {
            val result = linkOrSignIn(credential)
            result.user ?: throw IllegalStateException("No user returned")
        }
    }

    suspend fun signUpWithEmail(email: String, password: String): Result<FirebaseUser> =
        runCatching {
            val result = auth.createUserWithEmailAndPassword(email, password).await()
            result.user ?: throw IllegalStateException("No user returned")
        }

    suspend fun signInWithEmail(email: String, password: String): Result<FirebaseUser> =
        runCatching {
            val result = auth.signInWithEmailAndPassword(email, password).await()
            result.user ?: throw IllegalStateException("No user returned")
        }

    fun emailCredential(email: String, password: String): AuthCredential =
        EmailAuthProvider.getCredential(email, password)

    fun signOut() {
        runCatching { googleClient.signOut() }
        auth.signOut()
    }
}
