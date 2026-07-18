package com.aaa.ai.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.concurrent.TimeUnit

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
        private val LAST_BONUS_DAY = longPreferencesKey("last_bonus_day")
        private val STREAK_KEY = intPreferencesKey("daily_streak")
        const val DEFAULT_BALANCE = 100
        private const val MAX_TX = 200
        private const val BASE_DAILY_BONUS = 50
        private const val MAX_STREAK_MULTIPLIER = 7
    }

    /** Result of a daily bonus claim attempt. */
    data class DailyBonus(val claimed: Boolean, val amount: Int, val streak: Int)

    /** Current-day epoch-day number (local). */
    private fun today(): Long = TimeUnit.MILLISECONDS.toDays(System.currentTimeMillis())

    /** Reactive streak counter. */
    val streakFlow: Flow<Int> = context.dataStore.data.map { it[STREAK_KEY] ?: 0 }

    /** True if a daily bonus has not yet been claimed today. */
    val canClaimDailyFlow: Flow<Boolean> = context.dataStore.data
        .map { (it[LAST_BONUS_DAY] ?: -1L) < today() }

    /**
     * Claim the once-per-day login bonus. Awards [BASE_DAILY_BONUS] * min(streak, 7).
     * Consecutive days increment the streak; a missed day resets it to 1.
     */
    suspend fun claimDailyBonus(): DailyBonus {
        val day = today()
        val prefs = context.dataStore.data.first()
        val last = prefs[LAST_BONUS_DAY] ?: -1L
        if (last >= day) return DailyBonus(false, 0, prefs[STREAK_KEY] ?: 0)
        val prevStreak = prefs[STREAK_KEY] ?: 0
        val newStreak = if (last == day - 1) prevStreak + 1 else 1
        val amount = BASE_DAILY_BONUS * newStreak.coerceAtMost(MAX_STREAK_MULTIPLIER)
        context.dataStore.edit { p ->
            p[LAST_BONUS_DAY] = day
            p[STREAK_KEY] = newStreak
            p[USER_POINTS_KEY] = (p[USER_POINTS_KEY] ?: DEFAULT_BALANCE) + amount
        }
        recordTransaction(PointsTransaction("earn", amount, "daily-streak-$newStreak"))
        return DailyBonus(true, amount, newStreak)
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
