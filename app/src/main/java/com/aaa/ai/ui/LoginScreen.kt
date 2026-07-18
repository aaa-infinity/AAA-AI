package com.aaa.ai.ui

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.aaa.ai.AuthViewModel
import kotlinx.coroutines.flow.collectLatest

@Composable
fun LoginScreen(
    authViewModel: AuthViewModel,
    isDark: Boolean,
    onToggleTheme: (Boolean) -> Unit
) {
    val context = LocalContext.current
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var isSignUp by remember { mutableStateOf(false) }

    val googleLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result -> authViewModel.signInWithGoogle(result.data) }

    val tgState by authViewModel.tgState.collectAsState()

    LaunchedEffect(Unit) {
        authViewModel.events.collectLatest { event ->
            when (event) {
                is AuthViewModel.AuthEvent.Error ->
                    Toast.makeText(context, event.message, Toast.LENGTH_LONG).show()
                else -> {}
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("AAA-AI", style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.primary)
        Text("Sign in to sync your points & history", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 24.dp))

        OutlinedTextField(
            value = email, onValueChange = { email = it },
            label = { Text("Email") }, singleLine = true,
            leadingIcon = { Icon(Icons.Filled.Email, contentDescription = null) },
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = password, onValueChange = { password = it },
            label = { Text("Password") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            leadingIcon = { Icon(Icons.Filled.Lock, contentDescription = null) },
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
        )

        Button(
            onClick = {
                if (email.isNotBlank() && password.length >= 6) {
                    if (isSignUp) authViewModel.signUp(email.trim(), password)
                    else authViewModel.signIn(email.trim(), password)
                } else {
                    Toast.makeText(context, "Enter email and password (min 6 chars)", Toast.LENGTH_SHORT).show()
                }
            },
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp)
        ) { Text(if (isSignUp) "Create Account" else "Sign In") }

        TextButton(onClick = { isSignUp = !isSignUp }) {
            Text(if (isSignUp) "Have an account? Sign In" else "New here? Create Account")
        }

        OutlinedButton(
            onClick = { googleLauncher.launch(authViewModel.googleSignInIntent()) },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Filled.Email, contentDescription = null, modifier = Modifier.size(18.dp).padding(end = 8.dp))
            Text("Continue with Google")
        }

        Button(
            onClick = { authViewModel.startTelegramLogin() },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            shape = RoundedCornerShape(12.dp),
            enabled = tgState !is AuthViewModel.TelegramLoginState.Polling
        ) {
            if (tgState is AuthViewModel.TelegramLoginState.Polling) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp).padding(end = 8.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary
                )
                Text("Verifying… return to app")
            } else {
                Icon(Icons.Filled.Send, contentDescription = null, modifier = Modifier.size(18.dp).padding(end = 8.dp))
                Text("Verify and Login via Telegram Bot")
            }
        }

        if (tgState is AuthViewModel.TelegramLoginState.Failed) {
            Text(
                (tgState as AuthViewModel.TelegramLoginState.Failed).message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 8.dp)
            )
        }

        TextButton(onClick = { onToggleTheme(!isDark) }) {
            Text("Toggle ${if (isDark) "Light" else "Dark"} theme")
        }
    }
}
