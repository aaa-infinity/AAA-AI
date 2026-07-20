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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.filled.Diamond
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.WorkspacePremium
import androidx.compose.material.icons.filled.Redeem
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
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
import androidx.compose.material3.Switch
import androidx.compose.material3.AlertDialog
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.compose.rememberImagePainter
import com.aaa.ai.AuthViewModel
import com.aaa.ai.MainViewModel
import com.aaa.ai.data.AppSettings
import com.aaa.ai.data.PointsTransaction
import com.aaa.ai.data.TelegramAuth
import com.aaa.ai.data.UserProfile
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

@Composable
fun ProfileScreen(
    authViewModel: AuthViewModel,
    mainViewModel: MainViewModel,
    profile: UserProfile.Profile,
    points: Int,
    transactions: List<PointsTransaction>,
    isDark: Boolean,
    onToggleTheme: (Boolean) -> Unit
) {
    val rank = UserProfile.rankFor(profile.lifetimeEarned)
    val isPremium by mainViewModel.isPremium.collectAsState()
    val userId by mainViewModel.userId.collectAsState()
    var editingName by remember { mutableStateOf(false) }
    var nameDraft by remember { mutableStateOf(profile.name) }
    var clearMsg by remember { mutableStateOf<String?>(null) }
    var promoCode by remember { mutableStateOf("") }
    var promoBusy by remember { mutableStateOf(false) }
    var ytVerifying by remember { mutableStateOf(false) }
    var ytVerified by remember { mutableStateOf(false) }
    var showPromoGuide by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val tgSession by TelegramAuth.sessionFlow.collectAsState(initial = TelegramAuth.Session())
    var clearing by remember { mutableStateOf(false) }
    val avatarPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? -> uri?.let { scope.launch { com.aaa.ai.data.UserProfile.setAvatar(ctx, it) } } }

    LaunchedEffect(profile.name) { nameDraft = profile.name }
    LaunchedEffect(tgSession.chatId) {
        if (tgSession.verified && mainViewModel.userId.value?.startsWith("tg_") == true) {
            mainViewModel.syncReferrals(tgSession.chatId)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (tgSession.verified) {
            item {
                val p = tgSession.profile
                Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null, tint = androidx.compose.ui.graphics.Color(0xFF229ED9))
                            Text("  Telegram Account", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 8.dp))
                            if (p.isPremium) Text("  ⭐ Premium", color = androidx.compose.ui.graphics.Color(0xFFFFD54A), style = MaterialTheme.typography.bodySmall)
                        }
                        val tgRows = listOfNotNull(
                            "ID" to (p.id.ifBlank { tgSession.chatId }.takeIf { it.isNotBlank() }),
                            "Username" to p.username.takeIf { it.isNotBlank() }?.let { "@$it" },
                            "First name" to p.firstName.takeIf { it.isNotBlank() },
                            "Last name" to p.lastName.takeIf { it.isNotBlank() },
                            "Language" to p.languageCode.takeIf { it.isNotBlank() },
                            "Phone" to p.phone.takeIf { it.isNotBlank() },
                        )
                        Column(modifier = Modifier.padding(top = 10.dp)) {
                            tgRows.forEach { (k, v) ->
                                Row(modifier = Modifier.padding(vertical = 3.dp)) {
                                    Text(k, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(90.dp))
                                    Text(v ?: "—", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                    }
                }
            }
        } else {
            item {
                val tgState by authViewModel.tgState.collectAsState()
                var linkCode by remember { mutableStateOf("") }
                Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null, tint = androidx.compose.ui.graphics.Color(0xFF229ED9))
                            Text("  Link Telegram", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 8.dp))
                        }
                        Text(
                            "Connect Telegram to sign in on any device and sync your wallet.",
                            style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)
                        )
                        Button(
                            onClick = { authViewModel.startTelegramLogin() },
                            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                            enabled = tgState !is AuthViewModel.TelegramLoginState.Polling
                        ) {
                            if (tgState is AuthViewModel.TelegramLoginState.Polling) {
                                androidx.compose.material3.CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp).padding(end = 8.dp), strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary
                                )
                                Text("Open Telegram & tap Start…")
                            } else {
                                Text("🔐 Link via Telegram (one tap)")
                            }
                        }
                        Text("Or paste the code from @AAA_Login_bot:", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 10.dp))
                        OutlinedTextField(
                            value = linkCode, onValueChange = { linkCode = it.uppercase().trim() },
                            label = { Text("Link code") }, singleLine = true,
                            modifier = Modifier.fillMaxWidth().padding(top = 6.dp)
                        )
                        Button(
                            onClick = {
                                scope.launch {
                                    val ok = com.aaa.ai.data.TelegramAuth.submitCode(ctx, linkCode, userId ?: "")
                                    if (!ok) android.widget.Toast.makeText(ctx, "Invalid or expired code", android.widget.Toast.LENGTH_SHORT).show()
                                }
                            },
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                            enabled = linkCode.length >= 6
                        ) { Text("Verify code") }
                        if (tgState is AuthViewModel.TelegramLoginState.Failed) {
                            Text(
                                (tgState as AuthViewModel.TelegramLoginState.Failed).message,
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(top = 6.dp)
                            )
                        }
                    }
                }
            }
        }

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
                        Text(profile.name.ifBlank { "Ari AI User" }, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 12.dp))
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
                    if (isPremium) {
                        Row(modifier = Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.WorkspacePremium, contentDescription = null,
                                tint = androidx.compose.ui.graphics.Color(0xFFFFB300))
                            Text("  Premium active", color = androidx.compose.ui.graphics.Color(0xFFFFB300),
                                style = MaterialTheme.typography.labelLarge)
                        }
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

        item {
            OutlinedButton(
                onClick = { onToggleTheme(!isDark) },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.AutoMirrored.Filled.MenuBook, contentDescription = null)
                Text(if (isDark) "  Switch to Light theme" else "  Switch to Dark theme")
            }
        }

        // Promo code redemption -> unlocks Premium time.
        item {
            Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Redeem, contentDescription = null, tint = androidx.compose.ui.graphics.Color(0xFFFFB300))
                        Text("  Redeem promo code", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 8.dp))
                    }
                    if (showPromoGuide) {
                        AsyncImage(
                            model = "https://aaa-ai-bot.aaateam.workers.dev/api/asset/public/promo_guide.png",
                            contentDescription = "Promo code guide",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp).clip(RoundedCornerShape(12.dp))
                        )
                        IconButton(onClick = { showPromoGuide = false }) {
                            Icon(Icons.Filled.Close, contentDescription = "Hide guide")
                        }
                    }
                    Text("Got a limited code from our channel? Unlock Premium time (first 30 users).",
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
                    OutlinedTextField(
                        value = promoCode, onValueChange = { promoCode = it.uppercase() },
                        label = { Text("Promo code") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                    )
                    Button(
                        onClick = {
                            promoBusy = true
                            scope.launch {
                                mainViewModel.redeemPromo(promoCode.trim())
                                promoBusy = false
                            }
                        },
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        enabled = promoCode.isNotBlank() && !promoBusy
                    ) {
                        Icon(Icons.Filled.Redeem, contentDescription = null)
                        Text(if (promoBusy) "  Redeeming…" else "  Redeem")
                    }
                    TextButton(onClick = { showPromoGuide = true }, modifier = Modifier.padding(top = 4.dp)) {
                        Text("How to redeem?")
                    }
                }
            }
        }

        // YouTube subscription verification -> grants bonus premium time.
        item {
            Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.PlayCircle, contentDescription = null, tint = androidx.compose.ui.graphics.Color(0xFFFF0000))
                        Text("  Verify YouTube subscription", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 8.dp))
                    }
                    Text("Subscribe to @AAA-FREE-AI on YouTube, then verify here for a bonus day of Premium.",
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
                    val userId = userId
                    if (ytVerified) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Text("  Verified — bonus claimed", color = MaterialTheme.colorScheme.primary,
                                style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(start = 6.dp))
                        }
                    } else {
                        Button(
                            onClick = {
                                if (userId != null) {
                                    ytVerifying = true
                                    val url = com.aaa.ai.data.PromoManager.ytConnectUrl(ctx, userId)
                                    ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)))
                                    // Refresh premium state when the user returns.
                                    scope.launch {
                                        kotlinx.coroutines.delay(4000)
                                        mainViewModel.checkPremium(userId)
                                        ytVerifying = false
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                            enabled = userId != null && !ytVerifying
                        ) {
                            Icon(Icons.Filled.PlayCircle, contentDescription = null)
                            Text(if (ytVerifying) "  Verifying…" else "  Verify with Google")
                        }
                    }
                }
            }
        }

        // Facebook community card.
        item {
            Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null, tint = androidx.compose.ui.graphics.Color(0xFF1877F2))
                        Text("  Join our Facebook community", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 8.dp))
                    }
                    Text("Tips, updates and giveaways — follow Ari AI on Facebook.",
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
                    Button(
                        onClick = { ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://www.facebook.com/share/1BzWH5P2bF/"))) },
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                    ) {
                        Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null)
                        Text("  Follow on Facebook")
                    }
                }
            }
        }

        item {
            // Notifications preference (local reminders for daily rewards / updates).
            val notifEnabled by com.aaa.ai.data.AppSettings.notificationsEnabled(ctx)
                .collectAsState(initial = true)
            Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Filled.Notifications, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                        Text("Notifications", style = MaterialTheme.typography.titleMedium)
                        Text("Daily reward & update reminders.", style = MaterialTheme.typography.bodySmall)
                    }
                    Switch(checked = notifEnabled, onCheckedChange = {
                        scope.launch { com.aaa.ai.data.AppSettings.setNotifications(ctx, it) }
                    })
                }
            }
        }

        item { Text("Points History", style = MaterialTheme.typography.titleMedium) }

        if (transactions.isEmpty()) {
            item { Text("No transactions yet.", style = MaterialTheme.typography.bodyMedium) }
        } else {
            items(transactions) { tx -> TransactionRow(tx) }
        }

        item {
            OutlinedButton(
                onClick = {
                    clearing = true
                    scope.launch {
                        val n = com.aaa.ai.data.CleanupManager.clearAllChats(ctx)
                        clearing = false
                        clearMsg = "Cleared $n chat conversation(s)."
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !clearing
            ) {
                Icon(Icons.Filled.Delete, contentDescription = null)
                Text(if (clearing) "  Clearing…" else "  Clear all history")
            }
        }

        if (clearMsg != null) {
            item { Text(clearMsg!!, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
        }

        item {
            val invites by mainViewModel.referralCount.collectAsState()
            OutlinedButton(
                onClick = {
                    val refLink = mainViewModel.referralLink(
                        if (userId?.startsWith("tg_") == true) tgSession.chatId else userId
                    )
                    val downloadUrl = ctx.getString(com.aaa.ai.R.string.app_download_url)
                    val share = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(
                            android.content.Intent.EXTRA_TEXT,
                            "Get Ari AI — unlimited free AI chat, image generation & downloaders.\n\n" +
                                "📲 Download the app: $downloadUrl\n" +
                                "🎁 Or start via my invite (I earn bonus points): $refLink"
                        )
                    }
                    ctx.startActivity(android.content.Intent.createChooser(share, "Share Ari AI"))
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Filled.Share, contentDescription = null)
                Text(if (invites > 0) "  Invite friends ($invites joined)" else "  Invite friends (+300 pts each)")
            }
        }

        item {
            OutlinedButton(onClick = { authViewModel.signOut() }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null)
                Text("  Sign Out")
            }
        }
    }
}

@Composable
private fun ProfileInfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
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
