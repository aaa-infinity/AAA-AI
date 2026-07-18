package com.aaa.ai.data

import android.app.Activity
import android.content.Context
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.LoadAdError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Official Google AdMob manager (Rewarded + Banner).
 *
 * Uses the Google sample test IDs so the app runs without a published AdMob
 * account. The App ID MUST match the one declared in AndroidManifest.xml.
 * - App ID:     ca-app-pub-3940256099942544~3347511713 (test)
 * - Rewarded:   ca-app-pub-3940256099942544/5224354917 (test)
 * - Banner:     ca-app-pub-3940256099942544/9218507163 (test)
 *
 * The rewarded ad is preloaded so it is ready the instant the user taps "Earn".
 * Points are credited ONLY when the user actually earns the reward
 * (onUserEarnedRewardListener). The 18+ NSFW tab uses the separate Adsterra
 * WebView flow (see [com.aaa.ai.ui.AdWebView]).
 */
object AdMobManager {

    const val ADMOB_APP_ID = "ca-app-pub-3940256099942544~3347511713"
    const val REWARDED_AD_UNIT = "ca-app-pub-3940256099942544/5224354917"
    const val BANNER_AD_UNIT = "ca-app-pub-3940256099942544/9218507163"

    private var rewardedAd: RewardedAd? = null
    private var appContext: Context? = null
    private val _isReady = MutableStateFlow(false)
    val isReady = _isReady.asStateFlow()

    fun initialize(context: Context) {
        appContext = context.applicationContext
        MobileAds.initialize(context) { }
        preload()
    }

    /** Preload a rewarded ad asynchronously in the background. */
    fun preload() {
        val ctx = appContext ?: return
        _isReady.value = false
        RewardedAd.load(
            ctx,
            REWARDED_AD_UNIT,
            AdRequest.Builder().build(),
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
     * (whether or not a reward was earned) — used to re-preload.
     */
    fun show(
        activity: Activity,
        onReward: () -> Unit,
        onClosed: () -> Unit = { preload() }
    ) {
        val ad = rewardedAd
        if (ad == null) {
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

    /** Build a fresh AdMob banner view (caller attaches it to the layout). */
    fun newBanner(context: Context): AdView =
        AdView(context).apply {
            adUnitId = BANNER_AD_UNIT
            setAdSize(AdSize.BANNER)
            loadAd(AdRequest.Builder().build())
        }
}
