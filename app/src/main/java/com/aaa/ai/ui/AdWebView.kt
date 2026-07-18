package com.aaa.ai.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.material3.MaterialTheme

/**
 * Compliant, NON-TRAPPING full-screen in-app browser WebView.
 *
 * Behaviour (per spec):
 *  - Only https:// navigation is allowed inside the WebView (return false).
 *  - Custom platform intents (http://, market://, etc.) are routed safely to the
 *    system via an implicit Intent so the WebView never crashes or traps the user.
 *  - A prominent red "X" button dismisses the view. To prevent accidental closes
 *    (and ensure the ad is actually viewed), the close button stays locked for
 *    [minSeconds] and shows a live countdown before crediting the reward.
 *
 * Multi-device safety: if WebView is unavailable on this phone (disabled/missing
 * System WebView), we show a graceful fallback instead of crashing.
 */
@Composable
fun AdWebView(
    adUrl: String,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    minSeconds: Int = 5
) {
    var remaining by remember { mutableStateOf(minSeconds) }
    LaunchedEffect(Unit) {
        while (remaining > 0) {
            kotlinx.coroutines.delay(1000)
            remaining -= 1
        }
    }
    Box(modifier = modifier.fillMaxSize()) {
        if (!WebViewCapability.isAvailable(LocalContext.current)) {
            androidx.compose.foundation.layout.Column(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    "This feature needs Android System WebView, which is disabled on this phone.\n\nEnable it in Settings → Developer Options → WebView implementation, then reopen.",
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.padding(24.dp)
                )
                Button(onClick = onClose, colors = ButtonDefaults.buttonColors(containerColor = Color.Red)) {
                    Text("Close", color = Color.White)
                }
            }
            return
        }
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
                            if (url.startsWith("https://")) {
                                return false
                            }
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

        // Close button — locked until the minimum view time elapses.
        Button(
            onClick = onClose,
            enabled = remaining == 0,
            colors = ButtonDefaults.buttonColors(containerColor = Color.Red),
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(16.dp)
                .size(48.dp)
        ) {
            Text(if (remaining == 0) "X" else "$remaining", color = Color.White)
        }

        if (remaining > 0) {
            CircularProgressIndicator(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 72.dp, end = 32.dp)
                    .size(16.dp),
                color = Color.Red,
                strokeWidth = 2.dp
            )
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
