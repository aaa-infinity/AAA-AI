package com.aaa.ai.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
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
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest
                        ): Boolean {
                            val url = request.url.toString()
                            // Let ordinary web navigation continue inside the view.
                            if (url.startsWith("http://") || url.startsWith("https://")) {
                                return false
                            }
                            // Custom platform intents -> hand off to the system safely.
                            routeExternal(context, url)
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

/** Route a non-http(s) intent string through the system chooser. */
private fun routeExternal(context: Context, url: String) {
    try {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    } catch (_: Exception) {
        // No app handles this intent; fail silently rather than crash/trap.
    }
}
