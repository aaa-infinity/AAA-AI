package com.aaa.ai.ui

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/**
 * In-app WebView that hosts the worker's native Telegram Login Widget page
 * (`/login`). The server's verify page calls `TgLoginBridge.onResult(json)` when
 * Telegram returns a verified user, which we surface back to the caller.
 *
 * This avoids the deep-link "open Telegram → background app → poll dies" problem:
 * the whole handshake happens inside the WebView, so the verification result is
 * delivered reliably to the app.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun TelegramLoginWebView(
    url: String,
    onResult: (TelegramUser) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    var loading by remember { mutableStateOf(true) }
    Box(modifier = modifier.fillMaxSize()) {
        AndroidView(
            factory = { context: Context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView?, url: String?) {
                            loading = false
                        }
                    }
                    addJavascriptInterface(object {
                        @JavascriptInterface
                        fun onResult(json: String) {
                            runCatching {
                                val u = org.json.JSONObject(json)
                                // Server may send a bare user object or a
                                // {token,user} wrapper; handle both.
                                val user = if (u.has("user")) u.getJSONObject("user") else u
                                onResult(
                                    TelegramUser(
                                        id = user.optString("id").ifBlank { user.optString("uid") },
                                        username = user.optString("username"),
                                        firstName = user.optString("first_name"),
                                        lastName = user.optString("last_name"),
                                        photoUrl = user.optString("photo_url")
                                    )
                                )
                            }
                        }
                    }, "TgLoginBridge")
                    loadUrl(url)
                }
            },
            modifier = Modifier.fillMaxSize()
        )
        if (loading) {
            CircularProgressIndicator(Modifier.align(Alignment.Center))
        }
    }
}

/** Lightweight verified Telegram user returned by the login WebView. */
data class TelegramUser(
    val id: String,
    val username: String = "",
    val firstName: String = "",
    val lastName: String = "",
    val photoUrl: String = ""
)
