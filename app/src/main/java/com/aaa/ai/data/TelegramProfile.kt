package com.aaa.ai.data

import org.json.JSONObject

/**
 * Telegram profile pulled from the login bot via the Worker `/api/verify` and
 * `/api/profile` endpoints. Mirrors the JSON shape returned by the server.
 */
data class TelegramProfile(
    val id: String = "",
    val firstName: String = "",
    val lastName: String = "",
    val username: String = "",
    val languageCode: String = "",
    val phone: String = "",
    val photoUrl: String = "",
    val isPremium: Boolean = false
) {
    companion object {
        fun fromJson(obj: JSONObject?): TelegramProfile? {
            if (obj == null) return null
            return TelegramProfile(
                id = obj.optLong("id", 0L).takeIf { it != 0L }?.toString() ?: obj.optString("id"),
                firstName = obj.optString("firstName"),
                lastName = obj.optString("lastName"),
                username = obj.optString("username"),
                languageCode = obj.optString("languageCode"),
                phone = obj.optString("phone"),
                photoUrl = obj.optString("photoUrl"),
                isPremium = obj.optBoolean("isPremium", false)
            )
        }
    }
}
