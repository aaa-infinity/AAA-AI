package com.aaa.ai.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.aaa.ai.data.model.ChatMessage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.chatStore: DataStore<Preferences> by preferencesDataStore(name = "chat_history")

/**
 * Persists one conversation per endpoint id as a newline-delimited
 * `isUser|timestamp|text` log (most-recent-last). Kept lightweight (no Room).
 */
object ChatHistory {
    fun load(context: Context, endpointId: String): Flow<List<ChatMessage>> =
        context.chatStore.data.map { prefs ->
            prefs[stringPreferencesKey("chat_$endpointId")]?.lines()
                ?.mapNotNull { line ->
                    val p = line.split("|", limit = 3)
                    if (p.size < 3) null else ChatMessage(
                        text = p[2],
                        isUser = p[0] == "1",
                        timestamp = p[1].toLongOrNull() ?: 0,
                        endpointId = endpointId
                    )
                } ?: emptyList()
        }

    suspend fun append(context: Context, endpointId: String, msg: ChatMessage) {
        context.chatStore.edit { prefs ->
            val key = stringPreferencesKey("chat_$endpointId")
            val existing = prefs[key].orEmpty()
            val line = "${if (msg.isUser) 1 else 0}|${msg.timestamp}|${msg.text.replace("\n", "\\n")}"
            prefs[key] = if (existing.isEmpty()) line else "$existing\n$line"
        }
    }

    suspend fun clear(context: Context, endpointId: String) {
        context.chatStore.edit { it.remove(stringPreferencesKey("chat_$endpointId")) }
    }
}
