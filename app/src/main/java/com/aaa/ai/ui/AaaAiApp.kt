package com.aaa.ai.ui

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Diamond
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aaa.ai.AuthViewModel
import com.aaa.ai.MainViewModel
import com.aaa.ai.R
import com.aaa.ai.data.ApiCategory
import com.aaa.ai.data.ApiEndpoint
import com.aaa.ai.data.EndpointCatalog
import com.aaa.ai.data.ResultKind
import com.aaa.ai.data.TelegramAuth
import com.aaa.ai.data.UserProfile
import com.aaa.ai.data.model.ParsedResult
import com.aaa.ai.ui.theme.BrandAmber
import com.aaa.ai.ui.theme.BrandPink
import com.aaa.ai.ui.theme.BrandPurple
import com.aaa.ai.ui.theme.BrandTeal
import com.aaa.ai.ui.AdBanner
import kotlinx.coroutines.launch

private enum class Screen { HOME, CHAT, DOWNLOADERS, TOOLS, GALLERIES, KEYS, PROFILE }

private data class TabDef(val screen: Screen, val title: String, val icon: ImageVector)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AaaAiApp(
    viewModel: MainViewModel,
    authViewModel: AuthViewModel,
    isDark: Boolean,
    onToggleTheme: (Boolean) -> Unit,
    onEarnRewarded: () -> Unit
) {
    val user by authViewModel.user.collectAsStateWithLifecycle()
    val tgSession by TelegramAuth.sessionFlow.collectAsStateWithLifecycle()
    val authenticated = user != null || tgSession.verified
    var confirmed18 by remember { mutableStateOf(false) }
    val startCtx = LocalContext.current

    LaunchedEffect(Unit) { TelegramAuth.refresh(startCtx) }

    LaunchedEffect(user?.uid, tgSession.verified) {
        val uid = user?.uid ?: "tg_${tgSession.chatId}"
        viewModel.setUserId(uid)
        if (!uid.isNullOrBlank()) {
            viewModel.checkPremium(uid)
            viewModel.refreshBalance()
        }
    }

    if (!authenticated) {
        LoginScreen(
            authViewModel = authViewModel,
            isDark = isDark,
            onToggleTheme = onToggleTheme
        )
        return
    }

    val points by viewModel.userPoints.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val result by viewModel.result.collectAsStateWithLifecycle()
    val chatMessages by viewModel.chatMessages.collectAsStateWithLifecycle()
    val isTyping by viewModel.isTyping.collectAsStateWithLifecycle()
    val transactions by viewModel.transactions.collectAsStateWithLifecycle(initialValue = emptyList())
    val profile by UserProfile.profileFlow(LocalContext.current).collectAsStateWithLifecycle(initialValue = UserProfile.Profile())
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var selected by remember { mutableStateOf(Screen.HOME) }
    var adsterraVisible by remember { mutableStateOf(false) }
    var showInsufficient by remember { mutableStateOf(false) }
    var lightboxUrl by remember { mutableStateOf<String?>(null) }
    var activeEndpoint by remember { mutableStateOf<ApiEndpoint?>(null) }
    var showingResult by remember { mutableStateOf(false) }
    var pendingNsfw by remember { mutableStateOf<ApiEndpoint?>(null) }
    var pendingPremium by remember { mutableStateOf<ApiEndpoint?>(null) }
    val appCtx = LocalContext.current
    var updateInfo by remember { mutableStateOf<com.aaa.ai.data.UpdateChecker.UpdateInfo?>(null) }
    LaunchedEffect(Unit) { updateInfo = com.aaa.ai.data.UpdateChecker.check(appCtx) }
    var celebrate by remember { mutableStateOf(false) }

    fun select(screen: Screen) { selected = screen; showingResult = false }

    val tabs = listOf(
        TabDef(Screen.HOME, "Home", Icons.Filled.Home),
        TabDef(Screen.CHAT, "Chat", Icons.AutoMirrored.Filled.Chat),
        TabDef(Screen.DOWNLOADERS, "Download", Icons.Filled.Download),
        TabDef(Screen.TOOLS, "Studio", Icons.Filled.Build),
        TabDef(Screen.GALLERIES, "Gallery", Icons.Filled.Image),
        TabDef(Screen.KEYS, "Keys", Icons.Filled.Key),
        TabDef(Screen.PROFILE, "Profile", Icons.Filled.AccountCircle)
    )

    LaunchedEffect(Unit) { viewModel.insufficientEvent.collect { showInsufficient = true } }
    LaunchedEffect(Unit) {
        viewModel.snackbar.collect { msg ->
            if (msg.contains("Points", ignoreCase = true) || msg.contains("added", ignoreCase = true)) {
                celebrate = true
            }
            scope.launch { snackbarHost.showSnackbar(msg) }
        }
    }

    fun activate(endpoint: ApiEndpoint, param: String) {
        if (endpoint.category == ApiCategory.NSFW && !confirmed18) { pendingNsfw = endpoint; return }
        if (endpoint.requiresPremium && !viewModel.isPremium.value) { pendingPremium = endpoint; return }
        activeEndpoint = endpoint
        when (viewModel.kindFor(endpoint)) {
            ResultKind.CHAT -> {
                selected = Screen.CHAT
                viewModel.loadChatFor(endpoint)
                if (param.isNotBlank()) viewModel.sendChat(endpoint, param)
            }
            else -> {
                showingResult = true
                selected = if (endpoint.isGallery) Screen.GALLERIES else Screen.TOOLS
                viewModel.runEndpoint(endpoint, param)
            }
        }
    }

    // ---------- Overlays ----------
    if (adsterraVisible) {
        BackHandler(enabled = true) {}
        AdWebView(adUrl = ADSTERRA_URL, onClose = { adsterraVisible = false; viewModel.rewardForAd() }, modifier = Modifier.fillMaxSize())
        return
    }
    if (lightboxUrl != null) { LightboxScreen(url = lightboxUrl!!, onClose = { lightboxUrl = null }); return }
    if (showInsufficient) {
        InsufficientPointsSheet(
            onDismiss = { showInsufficient = false },
            onEarn = {
                showInsufficient = false
                if (selected == Screen.GALLERIES && activeEndpoint?.category == ApiCategory.NSFW) adsterraVisible = true
                else onEarnRewarded()
            }
        )
    }
    if (pendingNsfw != null) {
        NsfwGateSheet(
            onConfirm = { confirmed18 = true; val ep = pendingNsfw; pendingNsfw = null; ep?.let { activate(it, "") } },
            onDismiss = { pendingNsfw = null }
        )
    }
    if (pendingPremium != null) {
        PremiumGateSheet(
            endpoint = pendingPremium!!,
            onDismiss = { pendingPremium = null },
            onRedeem = {
                val ep = pendingPremium; pendingPremium = null
                viewModel.checkPremium(viewModel.userId.value)
                ep?.let { activate(it, "") }
            }
        )
    }
    updateInfo?.let { info ->
        var downloading by remember { mutableStateOf(false) }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { if (!info.required && !downloading) updateInfo = null },
            title = { Text("Update available" + if (info.versionName.isNotBlank()) " (${info.versionName})" else "") },
            text = {
                Column {
                    Text(if (info.required) "A required update is available. Please update to continue."
                         else "A new version of Ari AI is ready. It will replace the current version.")
                    if (info.changelog.isNotBlank()) {
                        androidx.compose.foundation.layout.Spacer(Modifier.height(8.dp))
                        Text(info.changelog, style = MaterialTheme.typography.bodySmall)
                    }
                    if (downloading) {
                        androidx.compose.foundation.layout.Spacer(Modifier.height(12.dp))
                        Text("Downloading update…", style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                Button(
                    enabled = !downloading,
                    onClick = {
                        downloading = true
                        scope.launch {
                            com.aaa.ai.data.UpdateChecker.downloadAndInstall(appCtx, info)
                            downloading = false
                        }
                    }
                ) { Text(if (downloading) "Downloading…" else "Update now") }
            },
            dismissButton = {
                if (!info.required && !downloading) TextButton(onClick = { updateInfo = null }) { Text("Later") }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Diamond, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        androidx.compose.foundation.layout.Spacer(Modifier.padding(4.dp))
                        Text(text = "$points", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                        Text(" pts", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                actions = {
                    val earnEnabled = !(selected == Screen.GALLERIES && activeEndpoint?.category == ApiCategory.NSFW)
                    val rewardReady by com.aaa.ai.data.AdMobManager.isReady.collectAsState()
                    val daily by viewModel.dailyRewardState.collectAsState()
                    Surface(
                        color = if (earnEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier.padding(end = 8.dp)
                    ) {
                        TextButton(
                            onClick = onEarnRewarded,
                            enabled = earnEnabled && rewardReady && !daily.claimedToday
                        ) {
                            Icon(Icons.Filled.Star, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                            Text(if (daily.claimedToday) "Claimed ✓" else "Earn +${daily.points}")
                        }
                    }
                    IconButton(onClick = { onToggleTheme(!isDark) }) {
                        Icon(Icons.AutoMirrored.Filled.MenuBook, contentDescription = "Theme")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                tabs.forEach { tab ->
                    val isSel = selected == tab.screen
                    val indicatorWidth by animateDpAsState(
                        targetValue = if (isSel) 36.dp else 0.dp,
                        animationSpec = spring(stiffness = Spring.StiffnessMedium)
                    )
                    NavigationBarItem(
                        selected = isSel,
                        onClick = { select(tab.screen) },
                        icon = {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(tab.icon, contentDescription = tab.title)
                                Box(
                                    modifier = Modifier
                                        .padding(top = 4.dp)
                                        .height(3.dp)
                                        .width(indicatorWidth)
                                        .clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.primary)
                                )
                            }
                        },
                        label = { Text(tab.title) },
                        colors = NavigationBarItemDefaults.colors(indicatorColor = MaterialTheme.colorScheme.primaryContainer)
                    )
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbarHost) }
    ) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            AnimatedContent(
                targetState = selected,
                label = "screenTransition"
            ) { screen ->
            when (screen) {
                Screen.HOME -> HomeScreen(viewModel = viewModel, onActivate = { ep, p -> activate(ep, p) }, onEarn = onEarnRewarded)
                Screen.CHAT -> {
                    val aiEndpoints = EndpointCatalog.byCategory(ApiCategory.AI_CHAT)
                    var hasKey by remember { mutableStateOf(false) }
                    LaunchedEffect(Unit) {
                        hasKey = com.aaa.ai.data.UserKeys.hasAnyKey(appCtx)
                    }
                    if (activeEndpoint == null) {
                        LaunchedEffect(Unit) {
                            val ep = aiEndpoints.first()
                            activeEndpoint = ep
                            viewModel.loadChatFor(ep)
                        }
                        Text("Loading…", modifier = Modifier.padding(16.dp))
                    } else {
                        if (!hasKey) {
                            Card(
                                onClick = { select(Screen.KEYS) },
                                shape = RoundedCornerShape(14.dp),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(Icons.Filled.Key, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                    Text(
                                        "Tap to add your free API key and unlock faster AI chat. Watch the tutorial in Your API Keys.",
                                        style = MaterialTheme.typography.bodySmall,
                                        modifier = Modifier.padding(start = 8.dp).weight(1f)
                                    )
                                }
                            }
                        }
                        ChatModelSelector(
                            selected = viewModel.chatProvider.value,
                            onSelect = { viewModel.chatProvider.value = it }
                        )
                        ChatScreen(
                            messages = chatMessages,
                            isTyping = isTyping,
                            onSend = { viewModel.sendChat(activeEndpoint!!, it) },
                            endpoints = aiEndpoints,
                            activeEndpoint = activeEndpoint!!,
                            onPickEndpoint = { newEp -> activeEndpoint = newEp; viewModel.loadChatFor(newEp) }
                        )
                    }
                }
                Screen.DOWNLOADERS -> ToolGrid(category = ApiCategory.DOWNLOADERS, viewModel = viewModel, onActivate = { ep, p -> activate(ep, p) })
                Screen.TOOLS -> ToolGrid(category = ApiCategory.UTILITIES, viewModel = viewModel, onActivate = { ep, p -> activate(ep, p) })
                Screen.GALLERIES -> {
                    if (showingResult && result != null) {
                        val ep = activeEndpoint ?: EndpointCatalog.byCategory(ApiCategory.VIP_GALLERIES).first()
                        ResultScreen(
                            result = result,
                            isLoading = isLoading,
                            endpoint = ep,
                            onRefresh = { viewModel.runEndpoint(ep, "") },
                            onOpenLightbox = { lightboxUrl = it }
                        )
                    } else {
                        ToolGrid(category = ApiCategory.VIP_GALLERIES, includeNsfw = true, viewModel = viewModel, onActivate = { ep, p -> activate(ep, p) })
                    }
                }
                Screen.PROFILE -> ProfileScreen(
                    authViewModel = authViewModel,
                    mainViewModel = viewModel,
                    profile = profile,
                    points = points,
                    transactions = transactions,
                    isDark = isDark,
                    onToggleTheme = onToggleTheme
                )
                Screen.KEYS -> ApiKeysScreen()
            }
            }
            if (celebrate) {
                RewardCelebration(onDone = { celebrate = false })
            }
        }
        }
    }
}

/** Redesigned home: branded hero + featured tools + quick earn. */
@Composable
private fun HomeScreen(
    viewModel: MainViewModel,
    onActivate: (ApiEndpoint, String) -> Unit,
    onEarn: () -> Unit
) {
    val featured = remember {
        EndpointCatalog.endpoints.filter {
            it.category == ApiCategory.AI_CHAT || it.id == "deepseek-r1" || it.id == "gpt-5"
        }.take(6)
    }
    val quick = listOf(
        Triple("AI Chat", Icons.AutoMirrored.Filled.Chat, BrandPurple),
        Triple("Downloaders", Icons.Filled.Download, BrandTeal),
        Triple("Studio", Icons.Filled.Build, BrandPink),
        Triple("Gallery", Icons.Filled.Image, BrandAmber)
    )
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Hero
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Box(
                modifier = Modifier.fillMaxWidth()
                    .background(
                        Brush.linearGradient(
                            listOf(BrandPurple, BrandIndigoSafe, BrandPink)
                        )
                    )
                    .padding(20.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Image(
                        painter = painterResource(id = R.drawable.logo_aaa),
                        contentDescription = "Ari AI",
                        modifier = Modifier.size(48.dp)
                    )
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("Ari AI", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
                        Text("Unlimited free AI · downloaders · studio", color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f))
                    }
                }
                Spacer(Modifier.height(12.dp))
                val daily by viewModel.dailyRewardState.collectAsState()
                Surface(color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.18f), shape = RoundedCornerShape(50)) {
                    TextButton(onClick = onEarn, enabled = !daily.claimedToday) {
                        Icon(Icons.Filled.Star, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary)
                        Text(
                            if (daily.claimedToday) "  Claimed today ✓" else "  Earn +${daily.points} pts",
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    }
                }
            }
        }

        // Daily streak bonus
        val canClaim by viewModel.canClaimDaily.collectAsStateWithLifecycle(initialValue = false)
        val streakDays by viewModel.streak.collectAsStateWithLifecycle(initialValue = 0)
        if (canClaim) {
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = BrandAmber.copy(alpha = 0.16f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text("Daily bonus ready", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        Text(
                            if (streakDays > 0) "Keep your $streakDays-day streak going" else "Claim points every day",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    Button(onClick = { viewModel.claimDailyBonus() }) {
                        Icon(Icons.Filled.Star, contentDescription = null)
                        Text("  Claim")
                    }
                }
            }
        }

        // Quick categories
        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(quick) { (label, icon, color) ->
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = color.copy(alpha = 0.14f),
                    modifier = Modifier.size(96.dp, 88.dp)
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(12.dp),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(28.dp))
                        Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 6.dp))
                    }
                }
            }
        }

        Text("Featured Tools", style = MaterialTheme.typography.titleMedium)
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            contentPadding = PaddingValues(bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth().weight(1f, fill = false)
        ) {
            items(featured) { endpoint ->
                EndpointCard(endpoint = endpoint, cost = viewModel.costFor(endpoint), onActivate = onActivate)
            }
        }

        // Passive banner ad (impression revenue; non-intrusive).
        AdBanner()
    }
}

@Composable
private fun ToolGrid(
    category: ApiCategory,
    viewModel: MainViewModel,
    onActivate: (ApiEndpoint, String) -> Unit,
    includeNsfw: Boolean = false
) {
    val endpoints = if (includeNsfw) {
        EndpointCatalog.endpoints.filter { it.category == category || it.category == ApiCategory.NSFW }
    } else if (category == ApiCategory.UTILITIES) {
        EndpointCatalog.endpoints.filter { it.category == ApiCategory.UTILITIES || it.category == ApiCategory.ANIME }
    } else {
        EndpointCatalog.byCategory(category)
    }
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        items(endpoints) { endpoint ->
            EndpointCard(endpoint = endpoint, cost = viewModel.costFor(endpoint), onActivate = onActivate)
        }
    }
}

private val BrandIndigoSafe = androidx.compose.ui.graphics.Color(0xFF536DFE)

private const val ADSTERRA_URL =
    "https://www.effectivecpmnetwork.com/rvipg3yyc?key=767d22f6f278a4a969cc8bb1e977455b"

/**
 * Lightweight confetti-style celebration shown when the user earns points.
 * Emoji particles float upward and fade; purely decorative (no external assets).
 */
@Composable
private fun RewardCelebration(onDone: () -> Unit) {
    val particles = remember {
        List(18) {
            Triple(
                (0..100).random() / 100f,
                listOf("🎉", "⭐", "💎", "🔥", "✨", "🪙")[it % 6],
                800 + (0..700).random()
            )
        }
    }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(1600); onDone() }
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        particles.forEach { (x, emoji, dur) ->
            val offsetY by animateFloatAsState(
                targetValue = -260f,
                animationSpec = tween(durationMillis = dur, easing = FastOutSlowInEasing),
                label = "confetti"
            )
            var shown by remember { mutableStateOf(true) }
            LaunchedEffect(Unit) { kotlinx.coroutines.delay(dur.toLong()); shown = false }
            if (shown) {
                Text(
                    emoji,
                    fontSize = 22.sp,
                    modifier = Modifier
                        .offset(x = (x * 320).dp - 160.dp, y = offsetY.dp)
                        .alpha(0.9f)
                )
            }
        }
    }
}
