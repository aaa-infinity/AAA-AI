package com.aaa.ai.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.settingsStore: DataStore<Preferences> by preferencesDataStore(name = "app_settings")

/** App-wide user preferences (notifications, etc.). */
object AppSettings {
    private val NOTIFICATIONS = booleanPreferencesKey("notifications_enabled")

    fun notificationsEnabled(context: Context): Flow<Boolean> =
        context.settingsStore.data.map { it[NOTIFICATIONS] != false } // default on

    suspend fun setNotifications(context: Context, enabled: Boolean) {
        context.settingsStore.edit { it[NOTIFICATIONS] = enabled }
    }
}
