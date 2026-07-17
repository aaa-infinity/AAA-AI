package com.aaa.ai.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * 18+ confirmation gate for NSFW gallery endpoints. The NSFW tab must never
 * surface explicit content until the user explicitly confirms they are 18+.
 * (AdMob is disabled on this surface per policy; the 18+ tab uses the
 * compliant Adsterra WebView for monetization instead.)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NsfwGateSheet(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("18+ Confirmation", style = MaterialTheme.typography.titleLarge)
            Text(
                "This section contains content intended for adults only. By continuing you confirm " +
                    "that you are at least 18 years of age and wish to view this content.",
                style = MaterialTheme.typography.bodyMedium
            )
            Button(onClick = onConfirm, modifier = Modifier.fillMaxWidth()) {
                Text("I am 18 or older — Continue")
            }
        }
    }
}
