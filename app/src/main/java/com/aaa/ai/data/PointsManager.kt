package com.aaa.ai.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "user_economy")

/**
 * A single points transaction (earn or spend), recorded for the history view.
 * Serialized as a compact `type|amount|reason|time` line.
 */
data class PointsTransaction(
    val type: String,        // "earn" | "spend"
    val amount: Int,
    val reason: String,      // e.g. "ad", "deepseek-r1"
    val timeMillis: Long = System.currentTimeMillis()
) {
    fun toLine(): String = "$type|$amount|$reason|$timeMillis"
    companion object {
        fun fromLine(line: String): PointsTransaction? {
            val p = line.split("|")
            if (p.size < 4) return null
            return runCatching {
                PointsTransaction(p[0], p[1].toInt(), p[2], p[3].toLong())
            }.getOrNull()
        }
    }
}

/**
 * Persistent points wallet backed by Jetpack DataStore.
 *
 * - Default starting balance: [DEFAULT_BALANCE] (100).
 * - [addPoints] credits the balance.
 * - [deductPoints] debits only if sufficient; returns true on success.
 * - Every change is recorded into an append-only log exposed by [transactionsFlow].
 */
class PointsManager(private val context: Context) {

    companion object {
        private val USER_POINTS_KEY = intPreferencesKey("user_points_balance")
        private val TX_KEY = stringPreferencesKey("points_transactions")
        const val DEFAULT_BALANCE = 100
        private const val MAX_TX = 200
    }

    /** Reactive balance stream, defaults to 100 when nothing stored yet. */
    val pointsFlow: Flow<Int> = context.dataStore.data
        .map { preferences -> preferences[USER_POINTS_KEY] ?: DEFAULT_BALANCE }

    /** Most-recent-first list of recorded transactions. */
    val transactionsFlow: Flow<List<PointsTransaction>> = context.dataStore.data
        .map { prefs ->
            prefs[TX_KEY]?.lines()
                ?.mapNotNull { PointsTransaction.fromLine(it) }
                ?.take(MAX_TX)
                ?: emptyList()
        }

    suspend fun addPoints(amount: Int, reason: String = "earn") {
        context.dataStore.edit { preferences ->
            val current = preferences[USER_POINTS_KEY] ?: DEFAULT_BALANCE
            preferences[USER_POINTS_KEY] = current + amount
        }
        recordTransaction(PointsTransaction("earn", amount, reason))
    }

    suspend fun deductPoints(amount: Int, reason: String = "spend"): Boolean {
        var success = false
        context.dataStore.edit { preferences ->
            val current = preferences[USER_POINTS_KEY] ?: DEFAULT_BALANCE
            if (current >= amount) {
                preferences[USER_POINTS_KEY] = current - amount
                success = true
            }
        }
        if (success) recordTransaction(PointsTransaction("spend", amount, reason))
        return success
    }

    private suspend fun recordTransaction(tx: PointsTransaction) {
        context.dataStore.edit { preferences ->
            val existing = preferences[TX_KEY].orEmpty()
            val next = buildString {
                append(tx.toLine())
                if (existing.isNotEmpty()) append("\n").append(existing)
            }.lines().take(MAX_TX).joinToString("\n")
            preferences[TX_KEY] = next
        }
    }
}
