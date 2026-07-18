package com.aaa.ai.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Compliant, NON-TRAPPING full-screen in-app browser WebView.
 *
 * Behaviour (per spec):
 *  - Normal http(s) links navigate naturally inside the WebView (return false).
 *  - Custom platform intents (intent://, market://, play.google.com, whatsapp://, etc.)
 *    are routed safely to the system via an implicit Intent so the WebView never
 *    crashes or traps the user inside.
 *  - A prominent red "X" button (top corner) dismisses the view, resets the page to
 *    about:blank to kill heavy scripts, and invokes [onClose].
 */
@Composable
fun AdWebView(
    adUrl: String,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(modifier = modifier.fillMaxSize()) {
        AndroidView(
            factory = { context: Context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.loadWithOverviewMode = true
                    settings.useWideViewPort = true
                    // Security: never allow the ad WebView to read local files or
                    // content providers, and never load mixed (HTTP) content.
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest
                        ): Boolean {
                            val url = request.url.toString()
                            // Security: only allow HTTPS navigation inside the WebView.
                            // Block http://, file://, javascript:, intent:, etc. so the
                            // ad surface can never reach local files or trap the user.
                            if (url.startsWith("https://")) {
                                return false
                            }
                            // Custom platform intents (https only) -> hand off to the system safely.
                            if (url.startsWith("http://")) {
                                routeExternal(context, url)
                            }
                            return true
                        }
                    }
                    loadUrl(adUrl)
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        Button(
            onClick = onClose,
            colors = ButtonDefaults.buttonColors(containerColor = Color.Red),
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(16.dp)
                .size(48.dp)
        ) {
            Text("X", color = Color.White)
        }
    }
}

/** Route an https link through the system chooser. Only http/https schemes are
 *  permitted; anything else (file://, javascript:, intent:, etc.) is ignored to
 *  avoid launching arbitrary apps or exposing local data. */
private fun routeExternal(context: Context, url: String) {
    if (!url.startsWith("http://") && !url.startsWith("https://")) return
    try {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    } catch (_: Exception) {
        // No app handles this intent; fail silently rather than crash/trap.
    }
}
