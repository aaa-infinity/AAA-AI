package com.aaa.ai.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Diamond
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.aaa.ai.AuthViewModel
import com.aaa.ai.MainViewModel
import com.aaa.ai.data.PointsTransaction
import com.aaa.ai.data.UserProfile
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

@Composable
fun ProfileScreen(
    viewModel: MainViewModel,
    authViewModel: AuthViewModel,
    profile: UserProfile.Profile,
    points: Int,
    transactions: List<PointsTransaction>,
    isDark: Boolean,
    onToggleTheme: (Boolean) -> Unit
) {
    val rank = UserProfile.rankFor(profile.lifetimeEarned)
    var editingName by remember { mutableStateOf(false) }
    var nameDraft by remember { mutableStateOf(profile.name) }
    val scope = rememberCoroutineScope()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val avatarPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? -> uri?.let { scope.launch { com.aaa.ai.data.UserProfile.setAvatar(ctx, it) } } }

    LaunchedEffect(profile.name) { nameDraft = profile.name }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(contentAlignment = Alignment.BottomEnd) {
                        if (profile.avatarUri != null) {
                            AsyncImage(
                                model = profile.avatarUri,
                                contentDescription = "Avatar",
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.size(88.dp).clip(CircleShape)
                            )
                        } else {
                            Icon(
                                Icons.Filled.Diamond, contentDescription = null,
                                modifier = Modifier.size(88.dp).clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primaryContainer)
                                    .padding(20.dp),
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                        IconButton(onClick = { avatarPicker.launch("image/*") }) {
                            Icon(Icons.Filled.Edit, contentDescription = "Change avatar")
                        }
                    }

                    if (editingName) {
                        OutlinedTextField(
                            value = nameDraft, onValueChange = { nameDraft = it },
                            label = { Text("Display name") }, singleLine = true,
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
                        )
                        Button(onClick = {
                            scope.launch { com.aaa.ai.data.UserProfile.setName(ctx, nameDraft.trim()) }
                            editingName = false
                        }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text("Save") }
                    } else {
                        Text(profile.name.ifBlank { "AAA-AI User" }, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 12.dp))
                        TextButton(onClick = { editingName = true }) { Text("Edit name") }
                    }

                    // Rank tier chip
                    val rankColor = when (rank) {
                        UserProfile.Rank.GOLD -> androidx.compose.ui.graphics.Color(0xFFFFB300)
                        UserProfile.Rank.SILVER -> androidx.compose.ui.graphics.Color(0xFFB0BEC5)
                        else -> MaterialTheme.colorScheme.primary
                    }
                    Card(colors = CardDefaults.cardColors(containerColor = rankColor.copy(alpha = 0.18f)), shape = RoundedCornerShape(50)) {
                        Text("${rank.title} Tier", modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                            color = rankColor, style = MaterialTheme.typography.labelLarge)
                    }
                    Row(modifier = Modifier.padding(top = 12.dp)) {
                        StatChip("Balance", "$points")
                        StatChip("Lifetime", "${profile.lifetimeEarned}")
                    }
                }
            }
        }

        item {
            Button(onClick = { /* earn handled via top bar AdMob */ }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.Star, contentDescription = null)
                Text("  Earn +200 (use Earn in top bar)")
            }
        }

        item { Text("Points History", style = MaterialTheme.typography.titleMedium) }

        if (transactions.isEmpty()) {
            item { Text("No transactions yet.", style = MaterialTheme.typography.bodyMedium) }
        } else {
            items(transactions) { tx -> TransactionRow(tx) }
        }

        item {
            OutlinedButton(onClick = { authViewModel.signOut() }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.Logout, contentDescription = null)
                Text("  Sign Out")
            }
        }
    }
}

@Composable
private fun StatChip(label: String, value: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.padding(4.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.titleMedium)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun TransactionRow(tx: PointsTransaction) {
    val fmt = SimpleDateFormat("MMM d, HH:mm", Locale.getDefault())
    val sign = if (tx.type == "earn") "+" else "-"
    val color = if (tx.type == "earn") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
    Card(shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(text = "$sign${tx.amount} pts · ${tx.reason}", color = color, style = MaterialTheme.typography.bodyMedium)
            Text(text = fmt.format(Date(tx.timeMillis)), style = MaterialTheme.typography.labelSmall)
        }
    }
}
