package com.aaa.ai.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * Local authenticated Telegram session flags, stored in Jetpack DataStore under
 * the application scope "com.aaa.ai". This is the source of truth for whether the
 * app frame has completed the deep-link verification handshake.
 */
object TelegramAuthSession {

    private val Context.sessionStore: DataStore<Preferences> by preferencesDataStore(name = "com.aaa.ai")

    private val VERIFIED = booleanPreferencesKey("tg_verified")
    private val CHAT_ID = stringPreferencesKey("tg_chat_id")
    private val TOKEN = stringPreferencesKey("tg_token")
    private val VERIFIED_AT = stringPreferencesKey("tg_verified_at")
    private val FIRST_NAME = stringPreferencesKey("tg_first_name")
    private val LAST_NAME = stringPreferencesKey("tg_last_name")
    private val USERNAME = stringPreferencesKey("tg_username")
    private val PHONE = stringPreferencesKey("tg_phone")
    private val PHOTO_URL = stringPreferencesKey("tg_photo_url")
    private val IS_PREMIUM = booleanPreferencesKey("tg_is_premium")

    data class Session(
        val verified: Boolean = false,
        val chatId: String? = null,
        val token: String? = null,
        val verifiedAt: String? = null,
        val firstName: String = "",
        val lastName: String = "",
        val username: String = "",
        val phone: String = "",
        val photoUrl: String = "",
        val isPremium: Boolean = false
    ) {
        val displayName: String
            get() = listOf(firstName, lastName).filter { it.isNotBlank() }.joinToString(" ")
                .ifBlank { if (username.isNotBlank()) "@$username" else "AAA User" }
    }

    fun sessionFlow(context: Context): Flow<Session> =
        context.sessionStore.data.map { prefs ->
            Session(
                verified = prefs[VERIFIED] ?: false,
                chatId = prefs[CHAT_ID],
                token = prefs[TOKEN],
                verifiedAt = prefs[VERIFIED_AT],
                firstName = prefs[FIRST_NAME] ?: "",
                lastName = prefs[LAST_NAME] ?: "",
                username = prefs[USERNAME] ?: "",
                phone = prefs[PHONE] ?: "",
                photoUrl = prefs[PHOTO_URL] ?: "",
                isPremium = prefs[IS_PREMIUM] ?: false
            )
        }

    /** Persist a finalized authenticated session after the polling loop confirms verification. */
    suspend fun saveVerified(context: Context, token: String, chatId: String, profile: TelegramProfile? = null) {
        context.sessionStore.edit { prefs ->
            prefs[VERIFIED] = true
            prefs[CHAT_ID] = chatId
            prefs[TOKEN] = token
            prefs[VERIFIED_AT] = System.currentTimeMillis().toString()
            if (profile != null) {
                prefs[FIRST_NAME] = profile.firstName
                prefs[LAST_NAME] = profile.lastName
                prefs[USERNAME] = profile.username
                prefs[PHONE] = profile.phone
                prefs[PHOTO_URL] = profile.photoUrl
                prefs[IS_PREMIUM] = profile.isPremium
            }
        }
    }

    /** Record the pending token while the deep link is open (pre-verification). */
    suspend fun savePending(context: Context, token: String) {
        context.sessionStore.edit { prefs ->
            prefs[VERIFIED] = false
            prefs[TOKEN] = token
        }
    }

    /** Read the pending (unverified) token, if any. Used to resume polling after
     *  the user returns from the Telegram app. */
    suspend fun loadPendingToken(context: Context): String? {
        val prefs = context.sessionStore.data.first()
        return if (prefs[VERIFIED] == true) null else prefs[TOKEN]
    }

    /** Clear the session (sign-out / reset). */
    suspend fun clear(context: Context) {
        context.sessionStore.edit { it.clear() }
    }
}
