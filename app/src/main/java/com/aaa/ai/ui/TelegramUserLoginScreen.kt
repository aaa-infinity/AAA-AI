package com.aaa.ai.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aaa.ai.data.TelegramUserClient
import kotlinx.coroutines.flow.collectLatest

/**
 * Telegram USER-ACCOUNT login screen (TDLib). Unlike the bot-based login, this
 * logs the app in as a real Telegram account. The user completes the one-time
 * phone -> code -> (2FA) handshake. After success the session is cached and the
 * account can post/send large files as the user.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TelegramUserLoginScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val state by TelegramUserClient.state.collectAsState()
    var phone by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        if (TelegramUserClient.isEnabled()) TelegramUserClient.start(context)
        else android.widget.Toast.makeText(context, "Telegram API credentials not configured", android.widget.Toast.LENGTH_LONG).show()
        TelegramUserClient.events.collectLatest { /* surfaced via state; could toast */ }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Telegram Account Login") }, navigationIcon = {
            IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = "Back") }
        }) }
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text("Link your Telegram account", style = MaterialTheme.typography.titleLarge)
            Text("Logs in as a real Telegram user (can send large files & post to channels).",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 24.dp))

            when (val s = state) {
                is TelegramUserClient.State.Ready -> {
                    Text("✅ Logged in as ${s.name}", color = MaterialTheme.colorScheme.primary)
                    Button(onClick = { TelegramUserClient.logOut() }, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
                        Text("Log out")
                    }
                }
                is TelegramUserClient.State.WaitingPhone -> {
                    OutlinedTextField(value = phone, onValueChange = { phone = it },
                        label = { Text("Phone (e.g. +1 555 0100)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Button(onClick = { if (phone.isNotBlank()) TelegramUserClient.submitPhone(phone) },
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) { Text("Send code") }
                }
                is TelegramUserClient.State.WaitingCode -> {
                    OutlinedTextField(value = code, onValueChange = { code = it },
                        label = { Text("Login code") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Button(onClick = { if (code.isNotBlank()) TelegramUserClient.submitCode(code) },
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) { Text("Verify code") }
                }
                is TelegramUserClient.State.WaitingPassword -> {
                    OutlinedTextField(value = password, onValueChange = { password = it },
                        label = { Text("2FA password") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth())
                    Button(onClick = { if (password.isNotBlank()) TelegramUserClient.submitPassword(password) },
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) { Text("Unlock") }
                }
                is TelegramUserClient.State.Loading -> CircularProgressIndicator()
                is TelegramUserClient.State.Error -> Text("Error: ${s.message}", color = MaterialTheme.colorScheme.error)
                else -> Text("Initializing…")
            }
        }
    }
}
