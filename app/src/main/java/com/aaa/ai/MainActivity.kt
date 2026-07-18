package com.aaa.ai

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.aaa.ai.data.AdMobManager
import com.aaa.ai.data.AppSettings
import com.aaa.ai.data.CleanupManager
import com.aaa.ai.data.DailyRewards
import com.aaa.ai.data.NotificationHelper
import com.aaa.ai.ui.AaaAiApp
import com.aaa.ai.ui.MainViewModelFactory
import com.aaa.ai.ui.theme.ThemeState
import com.aaa.ai.ui.theme.aaaDarkColorScheme
import com.aaa.ai.ui.theme.aaaLightColorScheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first

class MainActivity : ComponentActivity() {

    private val factory by lazy { MainViewModelFactory(application) }
    private val viewModel: MainViewModel by viewModels(factoryProducer = { factory })
    private val authViewModel: AuthViewModel by viewModels(factoryProducer = { factory })

    override fun onCreate(savedInstanceState: Bundle?) {
        try {
            super.onCreate(savedInstanceState)
            AdMobManager.initialize(applicationContext)
            CleanupManager.runStartupCleanup(applicationContext)
            // Remind the user to claim their daily reward if notifications are enabled.
            lifecycleScope.launch {
                try {
                    val enabled = com.aaa.ai.data.AppSettings.notificationsEnabled(applicationContext).first()
                    if (enabled && com.aaa.ai.data.DailyRewards.state(applicationContext).first().claimedToday.not()) {
                        delay(1500)
                        com.aaa.ai.data.NotificationHelper.notifyReward(applicationContext)
                    }
                } catch (t: Throwable) {
                    Log.e("SuperAI", "reward reminder failed", t)
                }
            }
            setContent {
                val dark by ThemeState.isDark(applicationContext)
                    .collectAsStateWithLifecycle(initialValue = false)

                MaterialTheme(
                    colorScheme = if (dark) aaaDarkColorScheme() else aaaLightColorScheme()
                ) {
                    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                        AaaAiApp(
                            viewModel = viewModel,
                            authViewModel = authViewModel,
                            isDark = dark,
                            onToggleTheme = { lifecycleScope.launch { ThemeState.setDark(applicationContext, it) } },
                            onEarnRewarded = { showRewardedAd() }
                        )
                    }
                }
            }
        } catch (t: Throwable) {
            // Last-resort guard: never let startup throw become a hard crash.
            Log.e("SuperAI", "onCreate crashed", t)
            reportCrash(t)
            renderErrorUi(t)
        }
    }

    /** Show the preloaded AdMob rewarded ad; credit +200 only when the reward is earned. */
    private fun showRewardedAd() {
        try {
            AdMobManager.show(
                activity = this,
                onReward = { viewModel.rewardForAd() },
                onClosed = { /* re-preload handled by AdMobManager */ }
            )
        } catch (t: Throwable) {
            Log.e("SuperAI", "showRewardedAd failed", t)
        }
    }

    /**
     * Resume an in-progress Telegram login when the user returns from the
     * Telegram app (the poll may have been cancelled while we were backgrounded).
     */
    override fun onResume() {
        try {
            super.onResume()
            authViewModel.resumeTelegramLogin()
        } catch (t: Throwable) {
            Log.e("SuperAI", "onResume failed", t)
        }
    }

    private fun reportCrash(t: Throwable) {
        val sw = java.io.StringWriter()
        t.printStackTrace(java.io.PrintWriter(sw))
        val app = application
        if (app is FirebaseApplication) app.reportCrashExternal("main", t)
    }

    private fun renderErrorUi(t: Throwable) {
        try {
            setContent {
                MaterialTheme(colorScheme = aaaDarkColorScheme()) {
                    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                        androidx.compose.foundation.layout.Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = androidx.compose.ui.Alignment.Center
                        ) {
                            androidx.compose.material3.Text(
                                "Something went wrong starting Super AI.\n\n${t.message ?: t.javaClass.simpleName}\n\nPlease reopen the app.",
                                color = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.padding(24.dp)
                            )
                        }
                    }
                }
            }
        } catch (ignored: Throwable) { }
    }
}
