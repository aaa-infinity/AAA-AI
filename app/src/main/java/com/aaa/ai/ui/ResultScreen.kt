package com.aaa.ai.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.aaa.ai.data.ApiEndpoint
import com.aaa.ai.data.Downloader
import com.aaa.ai.data.model.ParsedResult
import com.aaa.ai.data.model.ResultItem

/**
 * Unified result renderer. Maps a [ParsedResult] into the correct native UI:
 *  - [ParsedResult.Image]  -> Coil gallery with save/view overlay
 *  - [ParsedResult.List]   -> structured result cards (search/npm/pinterest…)
 *  - [ParsedResult.TextBlock] -> formatted scrollable typography
 *  - [ParsedResult.Chat]   -> plain text fallback
 *
 * Raw JSON is never displayed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResultScreen(
    result: ParsedResult?,
    isLoading: Boolean,
    endpoint: ApiEndpoint,
    onRefresh: () -> Unit,
    onOpenLightbox: (String) -> Unit
) {
    val ptrState = rememberPullToRefreshState()

    PullToRefreshBox(isRefreshing = isLoading, state = ptrState, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        when {
            isLoading && result == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            result == null -> EmptyState()
            result is ParsedResult.Image -> ImageResult(result.url, endpoint, onOpenLightbox)
            result is ParsedResult.List -> ListResult(result.items)
            result is ParsedResult.TextBlock -> TextBlockResult(result)
            result is ParsedResult.Chat -> TextBlockResult(ParsedResult.TextBlock(null, result.text))
        }
    }
}

@Composable
private fun EmptyState() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Filled.Image, contentDescription = null, modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Nothing here yet", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
            Text("Pull down to load, or use an endpoint card.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ImageResult(url: String, endpoint: ApiEndpoint, onOpenLightbox: (String) -> Unit) {
    val context = LocalContext.current
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        AsyncImage(
            model = coil.request.ImageRequest.Builder(context).data(url).crossfade(true).build(),
            contentDescription = endpoint.name,
            contentScale = ContentScale.FillWidth,
            modifier = Modifier.fillMaxWidth().padding(12.dp)
        )
        androidx.compose.foundation.layout.Row(
            modifier = Modifier.align(Alignment.TopEnd).padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            IconButton(onClick = { Downloader.saveImage(context, url, endpoint.id) }) {
                Icon(Icons.Filled.Download, contentDescription = "Save image", tint = MaterialTheme.colorScheme.primary)
            }
            IconButton(onClick = { onOpenLightbox(url) }) {
                Icon(Icons.Filled.Image, contentDescription = "View full", tint = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
private fun ListResult(items: List<ResultItem>) {
    if (items.isEmpty()) { EmptyState(); return }
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        items(items) { item -> ResultItemCard(item) }
    }
}

@Composable
private fun ResultItemCard(item: ResultItem) {
    val context = LocalContext.current
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp)) {
            if (!item.thumbnail.isNullOrBlank()) {
                AsyncImage(
                    model = item.thumbnail, contentDescription = item.title,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().size(120.dp).clip(RoundedCornerShape(12.dp))
                )
            }
            if (!item.title.isNullOrBlank()) {
                Text(item.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            if (!item.subtitle.isNullOrBlank()) {
                Text(item.subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
            if (!item.body.isNullOrBlank()) {
                Text(item.body, style = MaterialTheme.typography.bodySmall, maxLines = 4, modifier = Modifier.padding(top = 4.dp))
            }
            if (!item.url.isNullOrBlank()) {
                val clipboard = LocalClipboardManager.current
                androidx.compose.foundation.layout.Row(modifier = Modifier.padding(top = 4.dp)) {
                    IconButton(onClick = { Downloader.saveImage(context, item.url, "result") }) {
                        Icon(Icons.Filled.Download, contentDescription = "Save", modifier = Modifier.size(18.dp))
                    }
                    IconButton(onClick = { clipboard.setText(AnnotatedString(item.url)) }) {
                        Icon(Icons.Filled.ContentCopy, contentDescription = "Copy", modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun TextBlockResult(block: ParsedResult.TextBlock) {
    val clipboard = LocalClipboardManager.current
    val scroll = rememberScrollState()
    Column(modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(scroll)) {
        block.title?.let {
            Text(it, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(bottom = 8.dp))
        }
        Text(block.body, style = MaterialTheme.typography.bodyLarge)
        IconButton(onClick = { clipboard.setText(AnnotatedString(block.body)) }, modifier = Modifier.padding(top = 8.dp)) {
            Icon(Icons.Filled.ContentCopy, contentDescription = "Copy")
        }
    }
}
