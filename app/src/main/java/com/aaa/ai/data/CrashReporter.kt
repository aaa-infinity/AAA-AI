package com.aaa.ai.data

import android.os.Build
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.net.URL

/**
 * Lightweight client-side crash reporter. Mirrors the essentials of the
 * Application-level handler but is safe to call from anywhere (UI or VM) without
 * needing the Application instance. Reports to the worker /api/crashlog.
 */
object CrashReporter {

    private const val TAG = "SuperAI"
    private const val ENDPOINT = "https://aaa-ai-bot.aaateam.workers.dev/api/crashlog"

    fun report(t: Throwable, threadName: String = Thread.currentThread().name) {
        val sw = java.io.StringWriter()
        t.printStackTrace(java.io.PrintWriter(sw))
        val stack = sw.toString()
        val message = t.message ?: t.javaClass.name
        Log.e(TAG, "Crash on $threadName: $message", t)
        try {
            val app = com.aaa.ai.FirebaseApplication.instanceOrNull()
            app?.reportCrashExternal(threadName, t)
        } catch (_: Throwable) { }
        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                val payload = """
                    {"message":${json(message)},"stack":${json(stack)},"thread":${json(threadName)},"device":{"model":${json(Build.MODEL)},"manufacturer":${json(Build.MANUFACTURER)},"sdk":${Build.VERSION.SDK_INT}}}
                """.trimIndent()
                val conn = URL(ENDPOINT).openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                conn.responseCode
                conn.disconnect()
            }
        }
    }

    private fun json(value: String): String =
        "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
}
