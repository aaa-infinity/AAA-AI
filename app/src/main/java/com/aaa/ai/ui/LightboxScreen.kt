package com.aaa.ai.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.aaa.ai.data.Downloader

/**
 * Full-screen image viewer (lightbox). Close button top-right; download + share below.
 * (Pinch-zoom can be added later via a zoomable-image library if desired.)
 */
@Composable
fun LightboxScreen(
    url: String,
    onClose: () -> Unit
) {
    val context = LocalContext.current
    Box(modifier = Modifier.fillMaxSize()) {
        AsyncImage(
            model = url,
            contentDescription = "Full image",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize()
        )
        IconButton(
            onClick = onClose,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(12.dp)
        ) {
            Icon(Icons.Filled.Close, contentDescription = "Close", tint = Color.White)
        }
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            IconButton(onClick = { Downloader.saveImage(context, url, "lightbox") }) {
                Icon(Icons.Filled.Download, contentDescription = "Download", tint = Color.White)
            }
            IconButton(onClick = {
                val share = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, url)
                }
                context.startActivity(
                    Intent.createChooser(share, "Share").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }) {
                Icon(Icons.Filled.Share, contentDescription = "Share", tint = Color.White)
            }
        }
    }
}
