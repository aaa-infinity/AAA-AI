package com.aaa.ai.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aaa.ai.data.ApiEndpoint

/**
 * Grid card for an endpoint. Tapping Run/Open invokes [onActivate] with the
 * endpoint and the (possibly empty) user input. Routing by kind happens in the caller.
 */
@Composable
fun EndpointCard(
    endpoint: ApiEndpoint,
    cost: Int,
    onActivate: (ApiEndpoint, String) -> Unit
) {
    var param by remember { mutableStateOf("") }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                text = endpoint.name,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold
            )
            Text(
                text = "-$cost pts",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary
            )

            if (endpoint.hasParam) {
                OutlinedTextField(
                    value = param,
                    onValueChange = { param = it },
                    placeholder = { Text(endpoint.label) },
                    singleLine = true,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Text),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp)
                )
                OutlinedButton(
                    onClick = { onActivate(endpoint, param) },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Run") }
            } else {
                TextButton(
                    onClick = { onActivate(endpoint, "") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp)
                ) { Text("Open") }
            }
        }
    }
}
