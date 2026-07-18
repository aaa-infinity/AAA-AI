package com.aaa.ai.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

/**
 * Auto-delete / cleanup system for the app.
 *
 * Keeps the local footprint small and respects the user's privacy by pruning:
 *  - old chat-history entries (older than [CHAT_MAX_AGE_MS])
 *  - the app's cache directory (Coil images, temp downloads)
 *
 * Runs automatically on app startup and can be triggered manually from Profile.
 */
object CleanupManager {

    private const val CHAT_HISTORY_STORE = "chat_history"
    private const val CHAT_MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000 // 7 days
    private const val CACHE_MAX_AGE_MS = 3L * 24 * 60 * 60 * 1000 // 3 days

    private val Context.chatStore
        get() = applicationContext.getSharedPreferences(CHAT_HISTORY_STORE, Context.MODE_PRIVATE)

    /** Prune stale local data. Safe to call on every launch. */
    fun runStartupCleanup(context: Context) {
        Thread { pruneChatHistory(context); pruneCache(context) }.start()
    }

    /** Full prune pass; returns number of items removed. */
    suspend fun runFullCleanup(context: Context): Int = withContext(Dispatchers.IO) {
        pruneChatHistory(context) + pruneCache(context)
    }

    /** Clear every locally stored chat (used by "Clear all history" in Profile). */
    suspend fun clearAllChats(context: Context): Int = withContext(Dispatchers.IO) {
        val prefs = context.chatStore
        val count = prefs.all.count { it.key.startsWith("chat_") }
        prefs.edit().clear().apply()
        count
    }

    private fun pruneChatHistory(context: Context): Int {
        val prefs = context.chatStore
        val cutoff = System.currentTimeMillis() - CHAT_MAX_AGE_MS
        var removed = 0
        val editor = prefs.edit()
        prefs.all.forEach { (key, value) ->
            if (key.startsWith("chat_") && value is String && value.isNotBlank()) {
                val last = value.lineSequence().lastOrNull() ?: ""
                val ts = last.split("|", limit = 3).getOrNull(1)?.toLongOrNull() ?: 0
                if (ts in 1 until cutoff) { editor.remove(key); removed++ }
            }
        }
        editor.apply()
        return removed
    }

    private fun pruneCache(context: Context): Int {
        val cache = context.cacheDir ?: return 0
        val cutoff = System.currentTimeMillis() - CACHE_MAX_AGE_MS
        var removed = 0
        cache.listFiles()?.forEach { f ->
            if (f.lastModified() < cutoff && deleteRecursively(f)) removed++
        }
        return removed
    }

    private fun deleteRecursively(file: java.io.File): Boolean {
        if (file.isDirectory) file.listFiles()?.forEach { deleteRecursively(it) }
        return file.delete()
    }
}
