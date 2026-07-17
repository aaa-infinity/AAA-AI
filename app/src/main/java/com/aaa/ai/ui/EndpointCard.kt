package com.aaa.ai.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aaa.ai.data.ApiCategory
import com.aaa.ai.data.ApiEndpoint
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Polished tool card. Each endpoint lives in its own OutlinedCard with a
 * contextual icon and a filled, labeled action button (search / download / open).
 */
@Composable
fun EndpointCard(
    endpoint: ApiEndpoint,
    cost: Int,
    onActivate: (ApiEndpoint, String) -> Unit
) {
    var param by remember { mutableStateOf("") }
    val icon = iconFor(endpoint.category)
    val actionLabel = when {
        endpoint.category == ApiCategory.DOWNLOADERS -> "Download"
        endpoint.category == ApiCategory.NSFW -> "View"
        endpoint.isGallery -> "Generate"
        endpoint.hasParam -> "Run"
        else -> "Open"
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            androidx.compose.foundation.layout.Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(end = 8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = endpoint.name, style = MaterialTheme.typography.titleSmall, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
                    Text(text = "-$cost pts", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                }
            }

            if (endpoint.hasParam) {
                OutlinedTextField(
                    value = param,
                    onValueChange = { param = it },
                    placeholder = { Text(endpoint.label) },
                    singleLine = true,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Text),
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
                )
                Button(
                    onClick = { onActivate(endpoint, param) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(icon, contentDescription = null, modifier = Modifier.padding(end = 6.dp))
                    Text(actionLabel)
                }
            } else {
                Button(
                    onClick = { onActivate(endpoint, "") },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)
                ) {
                    Text(actionLabel)
                }
            }
        }
    }
}

private fun iconFor(category: ApiCategory): ImageVector = when (category) {
    ApiCategory.AI_CHAT -> Icons.Filled.Chat
    ApiCategory.DOWNLOADERS -> Icons.Filled.Download
    ApiCategory.UTILITIES -> Icons.Filled.Search
    ApiCategory.ANIME -> Icons.Filled.Search
    ApiCategory.VIP_GALLERIES -> Icons.Filled.Image
    ApiCategory.NSFW -> Icons.Filled.Image
}
