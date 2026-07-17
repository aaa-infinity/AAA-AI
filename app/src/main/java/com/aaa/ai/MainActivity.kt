package com.aaa.ai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.aaa.ai.ui.AaaAiApp
import com.aaa.ai.ui.MainViewModelFactory
import com.aaa.ai.ui.theme.ThemeState
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels(
        factoryProducer = { MainViewModelFactory(application) }
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val dark by ThemeState.isDark(applicationContext)
                .collectAsStateWithLifecycle(initialValue = false)

            MaterialTheme(
                colorScheme = if (dark) darkColorScheme() else lightColorScheme()
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AaaAiApp(
                        viewModel = viewModel,
                        isDark = dark,
                        onToggleTheme = {
                            lifecycleScope.launch { ThemeState.setDark(applicationContext, it) }
                        }
                    )
                }
            }
        }
    }
}
