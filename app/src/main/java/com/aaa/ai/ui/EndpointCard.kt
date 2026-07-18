package com.aaa.ai.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aaa.ai.data.ApiCategory
import com.aaa.ai.data.ApiEndpoint
import com.aaa.ai.ui.theme.BrandAmber
import com.aaa.ai.ui.theme.BrandPink
import com.aaa.ai.ui.theme.BrandPurple
import com.aaa.ai.ui.theme.BrandTeal

/**
 * Polished tool card with a category-colored accent, a cost chip and a
 * labeled action button (download / generate / run / open).
 */
@Composable
fun EndpointCard(
    endpoint: ApiEndpoint,
    cost: Int,
    onActivate: (ApiEndpoint, String) -> Unit
) {
    var param by remember { mutableStateOf("") }
    val (icon, color) = styleFor(endpoint.category)
    val actionLabel = when {
        endpoint.category == ApiCategory.DOWNLOADERS -> "Download"
        endpoint.category == ApiCategory.NSFW -> "View"
        endpoint.isGallery -> "Generate"
        endpoint.hasParam -> "Run"
        else -> "Open"
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(color.copy(alpha = 0.16f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(20.dp))
                }
                Column(modifier = Modifier.weight(1f).padding(start = 10.dp)) {
                    Text(text = endpoint.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(text = "-$cost pts", style = MaterialTheme.typography.labelSmall, color = color, fontWeight = FontWeight.Bold)
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
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = color)
                ) {
                    Icon(icon, contentDescription = null, modifier = Modifier.padding(end = 6.dp))
                    Text(actionLabel)
                }
            } else {
                Button(
                    onClick = { onActivate(endpoint, "") },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = color.copy(alpha = 0.85f))
                ) {
                    Text(actionLabel)
                }
            }
        }
    }
}

private fun styleFor(category: ApiCategory): Pair<ImageVector, Color> = when (category) {
    ApiCategory.AI_CHAT -> Icons.Filled.Chat to BrandPurple
    ApiCategory.DOWNLOADERS -> Icons.Filled.Download to BrandTeal
    ApiCategory.UTILITIES -> Icons.Filled.Search to BrandAmber
    ApiCategory.ANIME -> Icons.Filled.Search to BrandAmber
    ApiCategory.VIP_GALLERIES -> Icons.Filled.Image to BrandPink
    ApiCategory.NSFW -> Icons.Filled.Image to BrandPink
}
