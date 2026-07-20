package com.aaa.ai.ui

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.Image
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.res.painterResource
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MailOutline
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
import kotlinx.coroutines.flow.collectLatest
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aaa.ai.AuthViewModel
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource

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
    var busy by remember { mutableStateOf(false) }

    val googleLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result -> authViewModel.signInWithGoogle(result.data) }

    val tgState by authViewModel.tgState.collectAsState()

    LaunchedEffect(Unit) {
        authViewModel.events.collectLatest { event ->
            when (event) {
                is AuthViewModel.AuthEvent.Error ->
                    Toast.makeText(context, event.message, Toast.LENGTH_LONG).show()
                is AuthViewModel.AuthEvent.Busy -> busy = event.value
                else -> {}
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // Brand mark
            Box(
                modifier = Modifier
                    .size(84.dp)
                    .background(
                        androidx.compose.ui.graphics.Brush.verticalGradient(
                            listOf(
                                MaterialTheme.colorScheme.primary,
                                MaterialTheme.colorScheme.tertiary
                            )
                        ),
                        RoundedCornerShape(24.dp)
                    ),
                contentAlignment = Alignment.Center
            ) {
                androidx.compose.foundation.Image(
                    painter = androidx.compose.ui.res.painterResource(com.aaa.ai.R.mipmap.ic_launcher_round),
                    contentDescription = "Super AI",
                    modifier = Modifier.size(64.dp)
                )
            }

            Text(
                "Super AI",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground
            )
            Text(
                "Sign in to sync your points & history",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

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
                modifier = Modifier.fillMaxWidth()
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
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy,
                shape = RoundedCornerShape(14.dp)
            ) { Text(if (isSignUp) "Create Account" else "Sign In") }

            TextButton(onClick = { isSignUp = !isSignUp }) {
                Text(if (isSignUp) "Have an account? Sign In" else "New here? Create Account")
            }

            OutlinedButton(
                onClick = { googleLauncher.launch(authViewModel.googleSignInIntent()) },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                enabled = !busy
            ) {
                Icon(Icons.Filled.MailOutline, contentDescription = null, modifier = Modifier.size(18.dp).padding(end = 8.dp))
                Text("Continue with Google")
            }

            OutlinedButton(
                onClick = { authViewModel.startTelegramLogin() },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                enabled = tgState !is AuthViewModel.TelegramLoginState.Polling
            ) {
                if (tgState is AuthViewModel.TelegramLoginState.Polling) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp).padding(end = 8.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Text("Open Telegram & tap Start…")
                } else {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null, modifier = Modifier.size(18.dp).padding(end = 8.dp))
                    Text("Continue with Telegram")
                }
            }

            if (tgState is AuthViewModel.TelegramLoginState.Failed) {
                Text(
                    (tgState as AuthViewModel.TelegramLoginState.Failed).message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }

            TextButton(onClick = { onToggleTheme(!isDark) }) {
                Text("Toggle ${if (isDark) "Light" else "Dark"} theme")
            }
        }
    }
}
