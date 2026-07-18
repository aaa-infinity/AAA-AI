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
import com.aaa.ai.data.ApiEndpoint

/**
 * Paywall gate for VIP-only endpoints (image generation + VIP/NSFW galleries).
 * The user must have an active Premium pass; otherwise they're prompted to redeem
 * a promo code (granted by the owner) to unlock.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PremiumGateSheet(
    endpoint: ApiEndpoint,
    onDismiss: () -> Unit,
    onRedeem: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Ari AI Premium", style = MaterialTheme.typography.titleLarge)
            Text(
                "\"${endpoint.name}\" is a VIP feature. Unlock Premium to use image generation and " +
                    "VIP galleries. Redeem a promo code (from the owner / broadcasts) to activate — " +
                    "or ask in the Telegram channel for the latest code.",
                style = MaterialTheme.typography.bodyMedium
            )
            Button(onClick = onRedeem, modifier = Modifier.fillMaxWidth()) {
                Text("Redeem a promo code")
            }
        }
    }
}
