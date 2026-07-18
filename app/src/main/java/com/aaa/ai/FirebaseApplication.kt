package com.aaa.ai

import android.app.Application
import android.os.Build
import android.util.Log
import com.aaa.ai.data.AdMobManager
import com.google.firebase.FirebaseApp
import com.google.firebase.crashlytics.ktx.crashlytics
import com.google.firebase.ktx.Firebase
import com.google.firebase.remoteconfig.ktx.remoteConfig
import com.google.firebase.remoteconfig.ktx.remoteConfigSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File
import java.net.URL

/**
 * Application class that initializes Firebase Crashlytics and fetches Remote Config.
 *
 * Remote Config is used for server-tunable flags (e.g. ad URL, feature toggles).
 * If Firebase is not configured (no real google-services.json), all calls are no-ops.
 */
class FirebaseApplication : Application() {

    companion object {
        private const val TAG = "SuperAI"
        private const val CRASH_ENDPOINT = "https://aaa-ai-bot.aaateam.workers.dev/api/crashlog"
    }

    override fun onCreate() {
        super.onCreate()
        installCrashReporter()
        // Initialize Firebase explicitly so Auth / Firestore work at runtime
        // (the google-services plugin generates config but does not auto-init here).
        runCatching { FirebaseApp.initializeApp(this) }
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

    /**
     * Installs a global uncaught-exception handler so a crash is reported to our
     * server (for diagnosis) and saved locally instead of silently "keeping stopping".
     */
    private fun installCrashReporter() {
        val default = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            reportCrash(thread, throwable)
            // Give the network send a brief moment, then delegate to the OS default
            // handler so Android still shows the crash dialog / restarts as normal.
            default?.uncaughtException(thread, throwable)
        }
    }

    private fun reportCrash(thread: Thread, throwable: Throwable) {
        val sw = java.io.StringWriter()
        throwable.printStackTrace(java.io.PrintWriter(sw))
        val stack = sw.toString()
        val message = throwable.message ?: throwable.javaClass.name
        Log.e(TAG, "Uncaught crash on ${thread.name}: $message", throwable)

        // 1) Persist locally so we can pull it off-device later if needed.
        runCatching {
            val file = File(filesDir, "last_crash.txt")
            file.writeText(
                "time=${System.currentTimeMillis()}\n" +
                    "thread=${thread.name}\n" +
                    "device=${Build.MANUFACTURER} ${Build.MODEL} (SDK ${Build.VERSION.SDK_INT})\n" +
                    "message=$message\n\n$stack"
            )
        }

        // 2) Post to our worker endpoint so we can read it remotely.
        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                val payload = """
                    {"message":${json(message)},"stack":${json(stack)},"thread":${json(thread.name)},"device":{"model":${json(Build.MODEL)},"manufacturer":${json(Build.MANUFACTURER)},"sdk":${Build.VERSION.SDK_INT}}}
                """.trimIndent()
                val conn = URL(CRASH_ENDPOINT).openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                conn.outputStream.use { it.write(payload.toByteArray()) }
                conn.responseCode
                conn.disconnect()
            }
        }
    }

    private fun json(value: String): String =
        "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
}
