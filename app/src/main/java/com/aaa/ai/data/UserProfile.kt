package com.aaa.ai.data

import android.content.Context
import android.net.Uri
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.profileStore: DataStore<Preferences> by preferencesDataStore(name = "user_profile")

/**
 * Local user profile (name, avatar, lifetime earned) backed by DataStore.
 *
 * The avatar is stored as a content URI string; the gallery/image picker is
 * wired in the Profile screen. Rank tier is derived from lifetime earned tokens.
 */
object UserProfile {

    private val NAME_KEY = stringPreferencesKey("profile_name")
    private val AVATAR_KEY = stringPreferencesKey("profile_avatar")
    private val LIFETIME_KEY = longPreferencesKey("lifetime_earned")

    data class Profile(
        val name: String = "",
        val avatarUri: String? = null,
        val lifetimeEarned: Long = 0
    )

    enum class Rank(val title: String, val minLifetime: Long) {
        BRONZE("Bronze", 0),
        SILVER("Silver", 500),
        GOLD("Gold", 2000)
    }

    fun profileFlow(context: Context): Flow<Profile> =
        context.profileStore.data.map { prefs ->
            Profile(
                name = prefs[NAME_KEY].orEmpty(),
                avatarUri = prefs[AVATAR_KEY],
                lifetimeEarned = prefs[LIFETIME_KEY] ?: 0
            )
        }

    suspend fun setName(context: Context, name: String) {
        context.profileStore.edit { it[NAME_KEY] = name }
    }

    suspend fun setAvatar(context: Context, uri: Uri?) {
        context.profileStore.edit { if (uri == null) it.remove(AVATAR_KEY) else it[AVATAR_KEY] = uri.toString() }
    }

    /** Record earned tokens into the lifetime counter (drives rank). */
    suspend fun addLifetime(context: Context, amount: Long) {
        context.profileStore.edit { prefs ->
            prefs[LIFETIME_KEY] = (prefs[LIFETIME_KEY] ?: 0) + amount
        }
    }

    fun rankFor(lifetimeEarned: Long): Rank = when {
        lifetimeEarned >= Rank.GOLD.minLifetime -> Rank.GOLD
        lifetimeEarned >= Rank.SILVER.minLifetime -> Rank.SILVER
        else -> Rank.BRONZE
    }
}
