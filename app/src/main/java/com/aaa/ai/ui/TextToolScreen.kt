package com.aaa.ai.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.aaa.ai.data.ApiEndpoint

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TextToolScreen(
    text: String?,
    isLoading: Boolean,
    endpoint: ApiEndpoint,
    onRefresh: () -> Unit
) {
    val clipboard = LocalClipboardManager.current
    val ptrState = rememberPullToRefreshState()

    PullToRefreshBox(
        isRefreshing = isLoading,
        state = ptrState,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize()
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            if (text == null) {
                Text("No result yet.", style = MaterialTheme.typography.bodyMedium)
            } else {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        androidx.compose.foundation.text.selection.SelectionContainer {
                            Text(
                                text = text,
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                        IconButton(onClick = { clipboard.setText(AnnotatedString(text)) }) {
                            Icon(Icons.Filled.ContentCopy, contentDescription = "Copy")
                        }
                    }
                }
            }
        }
    }
}
