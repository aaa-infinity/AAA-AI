package com.aaa.ai.ui

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aaa.ai.MainViewModel
import com.aaa.ai.data.ApiCategory
import com.aaa.ai.data.ApiEndpoint
import com.aaa.ai.data.EndpointCatalog
import com.aaa.ai.data.ResultKind
import com.aaa.ai.ui.theme.ThemeState
import kotlinx.coroutines.launch

private enum class Screen { CHAT, DOWNLOADERS, TOOLS, GALLERIES, EARN, HISTORY }

private data class TabDef(val screen: Screen, val title: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AaaAiApp(
    viewModel: MainViewModel,
    isDark: Boolean,
    onToggleTheme: (Boolean) -> Unit
) {
    val points by viewModel.userPoints.collectAsStateWithLifecycle()
    val chatMessages by viewModel.chatMessages.collectAsStateWithLifecycle()
    val isTyping by viewModel.isTyping.collectAsStateWithLifecycle()
    val galleryUrl by viewModel.galleryUrl.collectAsStateWithLifecycle()
    val toolText by viewModel.toolText.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val transactions by viewModel.transactions.collectAsStateWithLifecycle(initialValue = emptyList())
    val ctx = LocalContext.current
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var selected by remember { mutableStateOf(Screen.CHAT) }
    var adVisible by remember { mutableStateOf(false) }
    var showInsufficient by remember { mutableStateOf(false) }
    var lightboxUrl by remember { mutableStateOf<String?>(null) }
    var activeEndpoint by remember { mutableStateOf<ApiEndpoint?>(null) }
    var showingResult by remember { mutableStateOf(false) }

    fun select(screen: Screen) {
        selected = screen
        showingResult = false
    }

    val tabs = listOf(
        TabDef(Screen.CHAT, "AI Chat", Icons.Filled.Chat),
        TabDef(Screen.DOWNLOADERS, "DL", Icons.Filled.Download),
        TabDef(Screen.TOOLS, "Tools", Icons.Filled.Build),
        TabDef(Screen.GALLERIES, "Gallery", Icons.Filled.Image),
        TabDef(Screen.EARN, "Earn", Icons.Filled.Star),
        TabDef(Screen.HISTORY, "History", Icons.Filled.AccountBalance)
    )

    // Route one-shot events
    LaunchedEffect(Unit) {
        viewModel.insufficientEvent.collect { showInsufficient = true }
    }
    LaunchedEffect(Unit) {
        viewModel.snackbar.collect { msg ->
            scope.launch { snackbarHost.showSnackbar(msg) }
        }
    }

    // Keep a CHAT endpoint loaded for the AI Chat tab (default: first AI endpoint)
    LaunchedEffect(selected) {
        if (selected == Screen.CHAT && activeEndpoint == null) {
            val ep = EndpointCatalog.byCategory(ApiCategory.AI_CHAT).first()
            activeEndpoint = ep
            viewModel.loadChatFor(ep)
        }
    }

    fun activate(endpoint: ApiEndpoint, param: String) {
        activeEndpoint = endpoint
        when (viewModel.kindFor(endpoint)) {
            ResultKind.CHAT -> {
                selected = Screen.CHAT
                viewModel.loadChatFor(endpoint)
                viewModel.sendChat(endpoint, param)
            }
            ResultKind.IMAGE -> {
                selected = Screen.GALLERIES
                showingResult = true
                viewModel.loadGallery(endpoint, param)
            }
            ResultKind.TEXT -> {
                selected = Screen.TOOLS
                showingResult = true
                viewModel.runTextTool(endpoint, param)
            }
        }
    }

    // ---------- Ad overlay ----------
    if (adVisible) {
        BackHandler(enabled = true) { /* swallow back while ad is open */ }
        AdWebView(
            adUrl = ADSTERRA_URL,
            onClose = {
                adVisible = false
                viewModel.rewardForAd()
            },
            modifier = Modifier.fillMaxSize()
        )
        return
    }

    // ---------- Lightbox overlay ----------
    if (lightboxUrl != null) {
        LightboxScreen(url = lightboxUrl!!, onClose = { lightboxUrl = null })
        return
    }

    // ---------- Insufficient sheet ----------
    if (showInsufficient) {
        InsufficientPointsSheet(
            onDismiss = { showInsufficient = false },
            onEarn = {
                showInsufficient = false
                adVisible = true
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Points Balance: $points 🪙",
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp
                    )
                },
                actions = {
                    Switch(checked = isDark, onCheckedChange = onToggleTheme)
                }
            )
        },
        bottomBar = {
            NavigationBar {
                tabs.forEach { tab ->
                    NavigationBarItem(
                        selected = selected == tab.screen,
                        onClick = { select(tab.screen) },
                        icon = { Icon(tab.icon, contentDescription = tab.title) },
                        label = { Text(tab.title) }
                    )
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbarHost) }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when (selected) {
                Screen.CHAT -> {
                    activeEndpoint?.let { ep ->
                        ChatScreen(
                            messages = chatMessages,
                            isTyping = isTyping,
                            onSend = { viewModel.sendChat(ep, it) }
                        )
                    } ?: Text("Loading…", modifier = Modifier.padding(16.dp))
                }
                Screen.GALLERIES -> {
                    if (showingResult && galleryUrl != null) {
                        val ep = activeEndpoint ?: EndpointCatalog.byCategory(ApiCategory.VIP_GALLERIES).first()
                        GalleryScreen(
                            url = galleryUrl,
                            isLoading = isLoading,
                            endpoint = ep,
                            onRefresh = { viewModel.clearGallery(); viewModel.loadGallery(ep, "") },
                            onOpenLightbox = { lightboxUrl = it }
                        )
                    } else {
                        EndpointGridScreen(
                            category = ApiCategory.VIP_GALLERIES,
                            viewModel = viewModel,
                            onActivate = { ep, p -> activate(ep, p) }
                        )
                    }
                }
                Screen.DOWNLOADERS -> EndpointGridScreen(
                    category = ApiCategory.DOWNLOADERS,
                    viewModel = viewModel,
                    onActivate = { ep, p -> activate(ep, p) }
                )
                Screen.TOOLS -> {
                    if (showingResult && toolText != null) {
                        val ep = activeEndpoint ?: EndpointCatalog.byCategory(ApiCategory.UTILITIES).first()
                        TextToolScreen(
                            text = toolText,
                            isLoading = isLoading,
                            endpoint = ep,
                            onRefresh = { viewModel.runTextTool(ep, "") }
                        )
                    } else {
                        EndpointGridScreen(
                            category = ApiCategory.UTILITIES,
                            viewModel = viewModel,
                            onActivate = { ep, p -> activate(ep, p) }
                        )
                    }
                }
                Screen.EARN -> {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Text("Watch a compliant ad to earn +200 points.", Modifier.padding(16.dp))
                        androidx.compose.material3.Button(onClick = { adVisible = true }) {
                            Text("Earn Tokens (+200)")
                        }
                    }
                }
                Screen.HISTORY -> HistoryScreen(transactions)
                else -> EndpointGridScreen(
                    category = when (selected) {
                        Screen.DOWNLOADERS -> ApiCategory.DOWNLOADERS
                        else -> ApiCategory.UTILITIES
                    },
                    viewModel = viewModel,
                    onActivate = { ep, p -> activate(ep, p) }
                )
            }
        }
    }
}

@Composable
private fun EndpointGridScreen(
    category: ApiCategory,
    viewModel: MainViewModel,
    onActivate: (ApiEndpoint, String) -> Unit
) {
    val endpoints = EndpointCatalog.byCategory(category)
    Column(modifier = Modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            items(endpoints) { endpoint ->
                EndpointCard(
                    endpoint = endpoint,
                    cost = viewModel.costFor(endpoint),
                    onActivate = onActivate
                )
            }
        }
    }
}

private const val ADSTERRA_URL =
    "https://www.effectivecpmnetwork.com/rvipg3yyc?key=767d22f6f278a4a969cc8bb1e977455b"
