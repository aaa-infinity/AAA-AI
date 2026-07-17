package com.aaa.ai

import android.app.Application
import com.aaa.ai.data.AdMobManager
import com.google.firebase.crashlytics.ktx.crashlytics
import com.google.firebase.ktx.Firebase
import com.google.firebase.remoteconfig.ktx.remoteConfig
import com.google.firebase.remoteconfig.ktx.remoteConfigSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Application class that initializes Firebase Crashlytics and fetches Remote Config.
 *
 * Remote Config is used for server-tunable flags (e.g. ad URL, feature toggles).
 * If Firebase is not configured (no real google-services.json), all calls are no-ops.
 */
class FirebaseApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        runCatching {
            Firebase.crashlytics.setCrashlyticsCollectionEnabled(true)
        }
        runCatching {
            AdMobManager.initialize(this)
        }
        runCatching {
            val config = Firebase.remoteConfig
            val settings = remoteConfigSettings {
                minimumFetchIntervalInSeconds = 3600
            }
            config.setConfigSettingsAsync(settings)
            CoroutineScope(Dispatchers.IO).launch {
                runCatching { config.fetchAndActivate().addOnCompleteListener { } }
            }
        }
    }
}
