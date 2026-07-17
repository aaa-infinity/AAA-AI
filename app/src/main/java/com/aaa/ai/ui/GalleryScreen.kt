package com.aaa.ai.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.aaa.ai.data.ApiEndpoint
import com.aaa.ai.data.Downloader

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GalleryScreen(
    url: String?,
    isLoading: Boolean,
    endpoint: ApiEndpoint,
    onRefresh: () -> Unit,
    onOpenLightbox: (String) -> Unit
) {
    val context = LocalContext.current
    val ptrState = rememberPullToRefreshState()

    Box(modifier = Modifier.fillMaxSize()) {
        PullToRefreshBox(
            isRefreshing = isLoading,
            state = ptrState,
            onRefresh = onRefresh
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                if (url == null) {
                    Text(
                        "No image yet. Pull down to load, or use the endpoint card above.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    if (isLoading) CircularProgressIndicator(modifier = Modifier.padding(top = 12.dp))
                } else {
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        AsyncImage(
                            model = ImageRequest.Builder(context)
                                .data(url)
                                .crossfade(true)
                                .build(),
                            contentDescription = endpoint.name,
                            contentScale = ContentScale.FillWidth,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(8.dp)
                        )
                    }
                    androidx.compose.foundation.layout.Row(
                        modifier = Modifier.padding(top = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        IconButton(onClick = {
                            val msg = Downloader.saveImage(context, url, endpoint.id)
                            // surface via snackbar handled by caller if needed
                        }) {
                            Icon(Icons.Filled.Download, contentDescription = "Download")
                        }
                        IconButton(onClick = {
                            val share = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, url)
                            }
                            context.startActivity(
                                Intent.createChooser(share, "Share image").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            )
                        }) {
                            Icon(Icons.Filled.Share, contentDescription = "Share")
                        }
                        IconButton(onClick = { onOpenLightbox(url) }) {
                            Text("View")
                        }
                    }
                }
            }
        }
    }
}
