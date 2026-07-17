package com.aaa.ai.ui.theme

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.themeStore: DataStore<Preferences> by preferencesDataStore(name = "app_theme")

object ThemeState {
    private val DARK_KEY = booleanPreferencesKey("dark_mode")

    fun isDark(context: Context): Flow<Boolean> =
        context.themeStore.data.map { it[DARK_KEY] ?: false }

    suspend fun setDark(context: Context, dark: Boolean) {
        context.themeStore.edit { it[DARK_KEY] = dark }
    }
}
