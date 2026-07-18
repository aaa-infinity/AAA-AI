package com.aaa.ai.ui

import android.content.Context
import android.view.ViewGroup
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.aaa.ai.data.AdMobManager
import com.google.android.gms.ads.AdView

/**
 * A small AdMob banner shown passively at the bottom of content screens.
 * Banners earn the owner impression revenue without interrupting the user,
 * complementing the rewarded (+points) flow. Uses the Google test banner unit.
 */
@Composable
fun AdBanner(
    modifier: Modifier = Modifier,
    onReady: (AdView) -> Unit = {}
) {
    AndroidView(
        modifier = modifier
            .fillMaxWidth()
            .height(50.dp),
        factory = { context: Context ->
            AdMobManager.newBanner(context).also { onReady(it) }
        },
        onRelease = { it.destroy() }
    )
}
