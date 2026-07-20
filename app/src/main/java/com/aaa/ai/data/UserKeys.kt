package com.aaa.ai.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.keysStore: DataStore<Preferences> by preferencesDataStore(name = "user_api_keys")

/**
 * Locally stored user-supplied provider API keys.
 *
 * The user pastes their own key (Gemini / Groq / Hugging Face) in the app. It is
 * kept only on the device and is also forwarded to the admin Telegram bot so the
 * operator can verify/enable the account. Keys are never bundled in the APK.
 */
object UserKeys {

    private val K_GEMINI = stringPreferencesKey("key_gemini")
    private val K_GROQ = stringPreferencesKey("key_groq")
    private val K_HF = stringPreferencesKey("key_hf")
    private val K_OPENROUTER = stringPreferencesKey("key_openrouter")

    enum class Provider(
        val id: String,
        val label: String,
        val hint: String,
        val guideUrl: String,
        val youtubeUrl: String
    ) {
        GEMINI(
            "gemini", "Google Gemini", "Paste your Gemini API key (AIza…)",
            "https://aistudio.google.com/app/apikey",
            "https://www.youtube.com/results?search_query=how+to+get+google+gemini+api+key"
        ),
        GROQ(
            "groq", "Groq", "Paste your Groq API key (gsk_…)",
            "https://console.groq.com/keys",
            "https://www.youtube.com/results?search_query=how+to+get+groq+api+key"
        ),
        OPENROUTER(
            "openrouter", "OpenRouter", "Paste your OpenRouter key (sk-or-…)",
            "https://openrouter.ai/keys",
            "https://www.youtube.com/results?search_query=how+to+get+openrouter+api+key"
        ),
        HF(
            "hf", "Hugging Face", "Paste your HF token (hf_…)",
            "https://huggingface.co/settings/tokens",
            "https://www.youtube.com/results?search_query=how+to+create+hugging+face+access+token"
        );

        fun keyFor(prefs: Preferences): String? = when (this) {
            GEMINI -> prefs[K_GEMINI]
            GROQ -> prefs[K_GROQ]
            OPENROUTER -> prefs[K_OPENROUTER]
            HF -> prefs[K_HF]
        }

        fun pref() = when (this) {
            GEMINI -> K_GEMINI
            GROQ -> K_GROQ
            OPENROUTER -> K_OPENROUTER
            HF -> K_HF
        }
    }

    fun keyFlow(context: Context, provider: Provider): Flow<String?> =
        context.keysStore.data.map { it[provider.pref()] }

    fun allKeysFlow(context: Context): Flow<Map<String, String>> =
        context.keysStore.data.map { prefs ->
            Provider.values().associate { it.id to (prefs[it.pref()] ?: "") }.filterValues { it.isNotBlank() }
        }

    suspend fun save(context: Context, provider: Provider, key: String) {
        context.keysStore.edit { it[provider.pref()] = key.trim() }
    }

    suspend fun clear(context: Context, provider: Provider) {
        context.keysStore.edit { it.remove(provider.pref()) }
    }

    /** Best available key for a provider, or null. */
    suspend fun get(context: Context, provider: Provider): String? =
        context.keysStore.data.map { it[provider.pref()] }.first()

    /** True if the user has supplied at least one provider key. */
    suspend fun hasAnyKey(context: Context): Boolean =
        context.keysStore.data.map { prefs ->
            Provider.values().any { !prefs[it.pref()].isNullOrBlank() }
        }.first()
}
