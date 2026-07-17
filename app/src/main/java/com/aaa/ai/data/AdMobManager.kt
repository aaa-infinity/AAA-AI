package com.aaa.ai.data

import android.app.Activity
import android.content.Context
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.LoadAdError
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.callbackFlow

/**
 * Official Google AdMob Rewarded Ads manager.
 *
 * - App ID: ca-app-pub-5356761432305414~6197972179
 * - Rewarded Unit: ca-app-pub-5356761432305414/1633443576
 *
 * The rewarded ad is preloaded in the background so it is ready the moment the
 * user taps "Earn Tokens (+200)". On a successful [onUserEarnedRewardListener]
 * callback the caller credits +200 points.
 *
 * Used on safe (non-NSFW) tabs only. The 18+ NSFW tab uses the separate
 * Adsterra WebView flow (see [com.aaa.ai.ui.AdWebView]).
 */
object AdMobManager {

    const val ADMOB_APP_ID = "ca-app-pub-5356761432305414~6197972179"
    const val REWARDED_AD_UNIT = "ca-app-pub-5356761432305414/1633443576"

    private var rewardedAd: RewardedAd? = null
    private var appContext: Context? = null
    private val _isReady = MutableStateFlow(false)
    val isReady: Flow<Boolean> = _isReady.asStateFlow()

    fun initialize(context: Context) {
        appContext = context.applicationContext
        MobileAds.initialize(context) {}
        preload()
    }

    /** Preload a rewarded ad asynchronously in the background. */
    fun preload() {
        val ctx = appContext ?: return
        _isReady.value = false
        val request = AdRequest.Builder().build()
        RewardedAd.load(
            ctx,
            REWARDED_AD_UNIT,
            request,
            object : RewardedAdLoadCallback() {
                override fun onAdLoaded(ad: RewardedAd) {
                    rewardedAd = ad
                    _isReady.value = true
                }
                override fun onAdFailedToLoad(error: LoadAdError) {
                    rewardedAd = null
                    _isReady.value = false
                }
            }
        )
    }

    /**
     * Show the preloaded rewarded ad. [onReward] is invoked only when the user
     * actually earns the reward. [onClosed] fires when the ad is dismissed
     * (whether or not a reward was earned) — use it to re-preload.
     */
    fun show(
        activity: Activity,
        onReward: () -> Unit,
        onClosed: () -> Unit = { preload() }
    ) {
        val ad = rewardedAd
        if (ad == null) {
            // not ready: attempt a quick reload then bail
            preload()
            onClosed()
            return
        }
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                rewardedAd = null
                _isReady.value = false
                onClosed()
            }
            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                rewardedAd = null
                _isReady.value = false
                onClosed()
            }
        }
        ad.show(activity) { onReward() }
    }
}
