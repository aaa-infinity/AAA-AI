package com.aaa.ai.ui

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Diamond
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Image
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aaa.ai.AuthViewModel
import com.aaa.ai.MainViewModel
import com.aaa.ai.data.ApiCategory
import com.aaa.ai.data.ApiEndpoint
import com.aaa.ai.data.EndpointCatalog
import com.aaa.ai.data.ResultKind
import com.aaa.ai.data.UserProfile
import com.aaa.ai.data.model.ParsedResult
import kotlinx.coroutines.launch

private enum class Screen { CHAT, DOWNLOADERS, TOOLS, GALLERIES, PROFILE }

private data class TabDef(val screen: Screen, val title: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

/**
 * Root composable. Shows a login gate when signed out, otherwise the main
 * scaffold with a refined top app bar (points balance + earn) and a bottom
 * navigation bar with indicator pills across five routes.
 *
 * @param onEarnRewarded invoked to show the AdMob rewarded ad (safe tabs).
 */
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
    var confirmed18 by remember { mutableStateOf(false) }

    LaunchedEffect(user?.uid) { viewModel.setUserId(user?.uid) }

    if (user == null) {
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
    val ctx = LocalContext.current
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var selected by remember { mutableStateOf(Screen.CHAT) }
    var adsterraVisible by remember { mutableStateOf(false) }
    var showInsufficient by remember { mutableStateOf(false) }
    var lightboxUrl by remember { mutableStateOf<String?>(null) }
    var activeEndpoint by remember { mutableStateOf<ApiEndpoint?>(null) }
    var showingResult by remember { mutableStateOf(false) }
    var pendingNsfw by remember { mutableStateOf<ApiEndpoint?>(null) }

    fun select(screen: Screen) { selected = screen; showingResult = false }

    val tabs = listOf(
        TabDef(Screen.CHAT, "AI Chat", Icons.Filled.Chat),
        TabDef(Screen.DOWNLOADERS, "Downloader", Icons.Filled.Download),
        TabDef(Screen.TOOLS, "Studio", Icons.Filled.Build),
        TabDef(Screen.GALLERIES, "Gallery", Icons.Filled.Image),
        TabDef(Screen.PROFILE, "Profile", Icons.Filled.AccountCircle)
    )

    LaunchedEffect(Unit) { viewModel.insufficientEvent.collect { showInsufficient = true } }
    LaunchedEffect(Unit) { viewModel.snackbar.collect { msg -> scope.launch { snackbarHost.showSnackbar(msg) } } }

    fun activate(endpoint: ApiEndpoint, param: String) {
        if (endpoint.category == ApiCategory.NSFW && !confirmed18) { pendingNsfw = endpoint; return }
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
                    Surface(
                        color = if (earnEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier.padding(end = 8.dp)
                    ) {
                        TextButton(onClick = onEarnRewarded, enabled = earnEnabled) {
                            Icon(Icons.Filled.Star, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                            Text("Earn +200")
                        }
                    }
                    IconButton(onClick = { onToggleTheme(!isDark) }) {
                        Icon(Icons.Filled.MenuBook, contentDescription = "Theme")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            )
        },
        bottomBar = {
            NavigationBar {
                tabs.forEach { tab ->
                    NavigationBarItem(
                        selected = selected == tab.screen,
                        onClick = { select(tab.screen) },
                        icon = { Icon(tab.icon, contentDescription = tab.title) },
                        label = { Text(tab.title) },
                        colors = NavigationBarItemDefaults.colors(indicatorColor = MaterialTheme.colorScheme.primaryContainer)
                    )
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbarHost) }
    ) { innerPadding ->
        Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            when (selected) {
                Screen.CHAT -> {
                    val aiEndpoints = EndpointCatalog.byCategory(ApiCategory.AI_CHAT)
                    if (activeEndpoint == null) {
                        LaunchedEffect(Unit) {
                            val ep = aiEndpoints.first()
                            activeEndpoint = ep
                            viewModel.loadChatFor(ep)
                        }
                        Text("Loading…", modifier = Modifier.padding(16.dp))
                    } else {
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
                    viewModel = viewModel,
                    authViewModel = authViewModel,
                    profile = profile,
                    points = points,
                    transactions = transactions,
                    isDark = isDark,
                    onToggleTheme = onToggleTheme
                )
            }
        }
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

private const val ADSTERRA_URL =
    "https://www.effectivecpmnetwork.com/rvipg3yyc?key=767d22f6f278a4a969cc8bb1e977455b"
