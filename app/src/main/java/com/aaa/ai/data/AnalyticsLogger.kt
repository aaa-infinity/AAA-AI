package com.aaa.ai.data

import android.content.Context
import com.google.firebase.analytics.ktx.analytics
import com.google.firebase.analytics.ktx.logEvent
import com.google.firebase.crashlytics.ktx.crashlytics
import com.google.firebase.ktx.Firebase

/**
 * Thin wrapper around Firebase Analytics + Crashlytics.
 *
 * All calls are guarded so the app works normally when Firebase is not initialized
 * (e.g. before a real google-services.json is supplied).
 */
object AnalyticsLogger {
    fun logAdWatched(context: Context) = runCatching {
        Firebase.analytics.logEvent("ad_watched") { param("reward", 200) }
    }

    fun logPointsEarned(amount: Int, reason: String) = runCatching {
        Firebase.analytics.logEvent("points_earned") {
            param("amount", amount.toLong())
            param("reason", reason)
        }
    }

    fun logPointsSpent(amount: Int, reason: String) = runCatching {
        Firebase.analytics.logEvent("points_spent") {
            param("amount", amount.toLong())
            param("reason", reason)
        }
    }

    fun logEndpointUsed(endpointId: String) = runCatching {
        Firebase.analytics.logEvent("endpoint_used") { param("endpoint", endpointId) }
    }

    fun logInsufficient(endpointId: String) = runCatching {
        Firebase.analytics.logEvent("insufficient_points") { param("endpoint", endpointId) }
    }

    fun logError(th: Throwable, message: String? = null) = runCatching {
        message?.let { Firebase.crashlytics.log(it) }
        Firebase.crashlytics.recordException(th)
    }
}
