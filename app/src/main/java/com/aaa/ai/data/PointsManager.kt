package com.aaa.ai.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "user_economy")

/**
 * Persistent points wallet backed by Jetpack DataStore.
 *
 * - Default starting balance: [DEFAULT_BALANCE] (100).
 * - [addPoints] credits the balance.
 * - [deductPoints] debits only if sufficient; returns true on success.
 */
class PointsManager(private val context: Context) {

    companion object {
        private val USER_POINTS_KEY = intPreferencesKey("user_points_balance")
        const val DEFAULT_BALANCE = 100
    }

    /** Reactive balance stream, defaults to 100 when nothing stored yet. */
    val pointsFlow: Flow<Int> = context.dataStore.data
        .map { preferences -> preferences[USER_POINTS_KEY] ?: DEFAULT_BALANCE }

    suspend fun addPoints(amount: Int) {
        context.dataStore.edit { preferences ->
            val current = preferences[USER_POINTS_KEY] ?: DEFAULT_BALANCE
            preferences[USER_POINTS_KEY] = current + amount
        }
    }

    suspend fun deductPoints(amount: Int): Boolean {
        var success = false
        context.dataStore.edit { preferences ->
            val current = preferences[USER_POINTS_KEY] ?: DEFAULT_BALANCE
            if (current >= amount) {
                preferences[USER_POINTS_KEY] = current - amount
                success = true
            }
        }
        return success
    }
}
