package com.aaa.ai.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aaa.ai.data.KeySubmitter
import com.aaa.ai.data.UserKeys
import kotlinx.coroutines.launch

/**
 * API Keys screen.
 *
 * The user pastes their own provider key. On save it is stored locally and
 * automatically forwarded to the admin Telegram bot (@AAA_ADMIN_APPS_bot) so the
 * operator can enable the account. A built-in guide explains where to get each key.
 */
@Composable
fun ApiKeysScreen() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    val scroll = rememberScrollState()

    var status by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(scroll),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Your API Keys", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(
            "Bring your own key for higher limits. Your key is saved on this device and sent to the admin bot to activate your account.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        UserKeys.Provider.values().forEach { provider ->
            ProviderKeyCard(
                provider = provider,
                onSaved = { key ->
                    status = "Saving & notifying admin…"
                    scope.launch {
                        UserKeys.save(ctx, provider, key)
                        val ok = KeySubmitter.submit(ctx, provider.id, key, userTag = "app-user")
                        status = if (ok) "✅ Saved & sent to admin bot." else "✅ Saved locally (admin notify later)."
                    }
                },
                onOpenGuide = { uriHandler.openUri(provider.guideUrl) }
            )
        }

        if (status != null) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer), shape = RoundedCornerShape(12.dp)) {
                Row(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text(status!!, modifier = Modifier.padding(start = 8.dp))
                }
            }
        }

        GuideCard(onOpenGuide = { uriHandler.openUri("https://aistudio.google.com/app/apikey") })
    }
}

@Composable
private fun ProviderKeyCard(
    provider: UserKeys.Provider,
    onSaved: (String) -> Unit,
    onOpenGuide: () -> Unit
) {
    var key by remember { mutableStateOf("") }
    Card(shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), elevation = CardDefaults.cardElevation(2.dp)) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Key, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text(provider.label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 8.dp).weight(1f))
                IconButton(onClick = onOpenGuide) { Icon(Icons.Filled.OpenInNew, contentDescription = "Guide") }
            }
            OutlinedTextField(
                value = key, onValueChange = { key = it },
                label = { Text(provider.hint) }, singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Row {
                Button(onClick = { if (key.isNotBlank()) onSaved(key.trim()) }, modifier = Modifier.weight(1f)) {
                    Text("Save & Activate")
                }
                TextButton(onClick = onOpenGuide) { Text("How to get") }
            }
        }
    }
}

@Composable
private fun GuideCard(onOpenGuide: () -> Unit) {
    Card(shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("How to get your free API key", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Text("1. Gemini — open Google AI Studio → API keys → Create.", style = MaterialTheme.typography.bodySmall)
            Text("2. Groq — sign in to console.groq.com → API Keys → Create.", style = MaterialTheme.typography.bodySmall)
            Text("3. Hugging Face — Settings → Access Tokens → New token.", style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = onOpenGuide) { Text("Open Gemini guide") }
        }
    }
}
