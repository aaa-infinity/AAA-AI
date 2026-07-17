package com.aaa.ai.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aaa.ai.data.PointsTransaction
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun HistoryScreen(transactions: List<PointsTransaction>) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp)
    ) {
        Text(
            "Points History",
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(bottom = 8.dp)
        )
        if (transactions.isEmpty()) {
            Text("No transactions yet.", style = MaterialTheme.typography.bodyMedium)
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(transactions) { tx ->
                    TransactionRow(tx)
                }
            }
        }
    }
}

@Composable
private fun TransactionRow(tx: PointsTransaction) {
    val fmt = SimpleDateFormat("MMM d, HH:mm", Locale.getDefault())
    val sign = if (tx.type == "earn") "+" else "-"
    val color = if (tx.type == "earn") MaterialTheme.colorScheme.primary
    else MaterialTheme.colorScheme.error
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                text = "$sign${tx.amount} pts  ·  ${tx.reason}",
                color = color,
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = fmt.format(Date(tx.timeMillis)),
                style = MaterialTheme.typography.labelSmall
            )
        }
    }
}
