package com.aaa.ai.data

import androidx.compose.runtime.Composable

/**
 * Bridge to the OPTIONAL Telegram USER-account (TDLib) login screen. That screen
 * lives in a separate source set (`src/tdlib`) which is only compiled when the
 * TDLib AAR is present. The tdlib set assigns [loginScreen] at class-init time;
 * when it is absent (no AAR), the button in [LoginScreen] is simply hidden, so
 * the app still builds and runs without TDLib.
 */
object TdlibBridge {
    var loginScreen: (@Composable (onBack: () -> Unit) -> Unit)? = null
}
