package com.aaa.ai.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.Calendar

private val Context.rewardStore: DataStore<Preferences> by preferencesDataStore(name = "daily_rewards")

/**
 * Daily reward streak tracker. Credits a base reward plus a streak bonus so users
 * who return every day earn progressively more. Resets the streak if a day is missed.
 */
object DailyRewards {
    private val LAST_DAY = longPreferencesKey("last_reward_day")   // epoch day number
    private val STREAK = intPreferencesKey("reward_streak")

    private fun todayDay(): Long {
        val c = Calendar.getInstance()
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0)
        c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis / 86_400_000L
    }

    data class Claim(val points: Int, val streak: Int, val claimedToday: Boolean)

    /** Compute today's reward and whether it was already claimed. */
    fun state(context: Context): Flow<Claim> = context.rewardStore.data.map { p ->
        val last = p[LAST_DAY] ?: 0L
        val streak = p[STREAK] ?: 0
        val today = todayDay()
        val claimedToday = last == today
        val points = if (claimedToday) 0 else rewardForStreak(streak)
        Claim(points = points, streak = streak, claimedToday = claimedToday)
    }

    /** Mark today's reward claimed; advances the streak. Returns points granted. */
    suspend fun claim(context: Context): Int {
        val today = todayDay()
        val p = context.rewardStore.data.map { it }.first()
        val last = p[LAST_DAY] ?: 0L
        val prevStreak = p[STREAK] ?: 0
        val newStreak = if (last == today - 1L) prevStreak + 1 else 1
        val pts = rewardForStreak(newStreak - 1) // bonus based on the streak we are starting
        context.rewardStore.edit {
            it[LAST_DAY] = today
            it[STREAK] = newStreak
        }
        return pts
    }

    /** Points for a given streak length (0-based). Caps at day 7+. */
    fun rewardForStreak(streak: Int): Int {
        val base = 200
        val bonus = when {
            streak <= 0 -> 0
            streak >= 7 -> 300
            else -> streak * 40
        }
        return base + bonus
    }
}
