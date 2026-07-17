package com.aaa.ai.ui

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.activity.compose.BackHandler
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.aaa.ai.MainViewModel
import com.aaa.ai.data.ApiCategory
import com.aaa.ai.data.ApiEndpoint
import com.aaa.ai.data.EndpointCatalog

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AaaAiApp(viewModel: MainViewModel) {
    val points by viewModel.userPoints.collectAsStateWithLifecycle()
    val response by viewModel.response.collectAsStateWithLifecycle()
    val imageUrl by viewModel.lastImageUrl.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val ctx = LocalContext.current

    var adVisible by remember { mutableStateOf(false) }

    if (adVisible) {
        // While the compliant ad overlay is shown, the only exit is the X button,
        // which both dismisses and grants the reward. The system Back button is
        // consumed so users don't accidentally leave without being rewarded.
        BackHandler(enabled = true) { /* intentionally swallow */ }
        AdWebView(
            adUrl = ADSTERRA_URL,
            onClose = {
                adVisible = false
                viewModel.rewardForAd()
                Toast.makeText(ctx, "+200 Points added!", Toast.LENGTH_LONG).show()
            },
            modifier = Modifier.fillMaxSize()
        )
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Points Balance: $points 🪙",
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp
                    )
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            var selectedTab by remember { mutableIntStateOf(0) }
            val categories = EndpointCatalog.categories

            TabRow(selectedTabIndex = selectedTab) {
                categories.forEachIndexed { index, category ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(category.title) }
                    )
                }
            }

            val endpoints = EndpointCatalog.byCategory(categories[selectedTab])

            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                items(endpoints) { endpoint ->
                    EndpointCard(
                        endpoint = endpoint,
                        cost = viewModel.costFor(endpoint),
                        onRun = { param -> viewModel.handleUserAction(endpoint, param) }
                    )
                }
            }

            // Result panel
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    if (isLoading) {
                        CircularProgressIndicator(modifier = Modifier.padding(8.dp))
                    }
                    if (imageUrl != null) {
                        AsyncImage(
                            model = imageUrl,
                            contentDescription = "Result image",
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 8.dp)
                        )
                    }
                    Text(
                        text = response,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }

            // Earn Tokens section
            Button(
                onClick = { adVisible = true },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp)
            ) {
                Text("Earn Tokens  (+200 ▶ Watch Ad)")
            }
        }
    }
}

@Composable
private fun EndpointCard(
    endpoint: ApiEndpoint,
    cost: Int,
    onRun: (String) -> Unit
) {
    var param by remember { mutableStateOf("") }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                text = endpoint.name,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.titleSmall
            )
            Text(
                text = "-$cost pts",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary
            )
            OutlinedTextField(
                value = param,
                onValueChange = { param = it },
                placeholder = { Text(endpoint.label) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 6.dp)
            )
            OutlinedButton(
                onClick = { onRun(param) },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Run")
            }
        }
    }
}

private const val ADSTERRA_URL =
    "https://www.effectivecpmnetwork.com/rvipg3yyc?key=767d22f6f278a4a969cc8bb1e977455b"
