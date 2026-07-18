package com.aaa.ai.ui

import android.os.Build
import android.webkit.WebView
import android.content.Context

/**
 * Multi-device safety for WebView.
 *
 * On some phones (Huawei, certain OEM ROMs, or devices where "Android System
 * WebView" is disabled in Developer Options) constructing a [WebView] throws an
 * exception. That used to crash the app on open of the Telegram-login or 18+ tab.
 *
 * [isAvailable] performs a guarded probe so callers can fall back gracefully
 * instead of crashing.
 */
object WebViewCapability {

    @Volatile
    private var cached: Boolean? = null

    fun isAvailable(context: Context): Boolean {
        cached?.let { return it }
        val ok = try {
            // Probe construction on a throwaway context.
            val wv = WebView(context.applicationContext)
            wv.destroy()
            true
        } catch (t: Throwable) {
            false
        }
        cached = ok
        return ok
    }
}
