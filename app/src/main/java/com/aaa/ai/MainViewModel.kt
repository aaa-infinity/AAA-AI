package com.aaa.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aaa.ai.data.ApiCost
import com.aaa.ai.data.ApiEndpoint
import com.aaa.ai.data.ApiRepository
import com.aaa.ai.data.AnalyticsLogger
import com.aaa.ai.data.DailyRewards
import com.aaa.ai.data.FirestoreBackend
import com.aaa.ai.data.PointsApi
import com.aaa.ai.data.PointsManager
import com.aaa.ai.data.ResultKind
import com.aaa.ai.data.UserProfile
import com.aaa.ai.data.model.ApiResponse
import com.aaa.ai.data.model.ChatMessage
import com.aaa.ai.data.model.ParsedResult
import com.aaa.ai.data.PointsTransaction
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Central view model for the points economy + all endpoint interactions.
 *
 * Points are SERVER-AUTHORITATIVE: all earn/spend mutations go through the
 * Cloudflare Worker (D1) via [PointsApi], and the live balance is read from the
 * server. When signed out, the local DataStore [PointsManager] is used instead.
 */
class MainViewModel(
    private val pointsManager: PointsManager,
    private val backend: FirestoreBackend,
    private val repository: ApiRepository,
    val appContext: android.content.Context
) : ViewModel() {

    /** Active user id (null when signed out). Drives backend routing. */
    private val _userId = MutableStateFlow<String?>(null)
    val userId: StateFlow<String?> = _userId

    fun setUserId(uid: String?) { _userId.value = uid }

    /**
     * Live authoritative balance for the signed-in user (sourced from the Worker /
     * D1). Null until the first successful fetch, then held here so mutations are
     * reflected instantly. Falls back to the local DataStore wallet when signed out.
     */
    private val _serverPoints = MutableStateFlow<Int?>(null)

    /** Reactive points balance from the correct backend based on auth state. */
    val userPoints: StateFlow<Int> = combine(_userId, _serverPoints, pointsManager.pointsFlow) { uid, server, local ->
        when {
            uid != null && server != null -> server
            uid != null -> PointsManager.DEFAULT_BALANCE
            else -> local
        }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = PointsManager.DEFAULT_BALANCE
    )

    /** Refresh the authoritative balance from the server for the active user. */
    fun refreshBalance() {
        val uid = _userId.value ?: return
        viewModelScope.launch {
            val bal = PointsApi.getBalance(appContext, uid)
            if (bal != null) _serverPoints.value = bal
        }
    }


    /** Transaction log (Firestore when signed in, else local DataStore). */
    val transactions: Flow<List<PointsTransaction>> = _userId.flatMapLatest { uid ->
        if (uid != null) backend.transactionsFlow(uid) else pointsManager.transactionsFlow
    }

    // --- Chat state ---
    private val _chatMessages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val chatMessages: StateFlow<List<ChatMessage>> = _chatMessages
    private val _isTyping = MutableStateFlow(false)
    val isTyping: StateFlow<Boolean> = _isTyping
    private var activeChatEndpoint: String = ""

    // --- Gallery / Text state ---
    private val _result = MutableStateFlow<ParsedResult?>(null)
    val result: StateFlow<ParsedResult?> = _result
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    // --- One-shot events ---
    private val _insufficientEvent = Channel<String>(Channel.BUFFERED)
    val insufficientEvent: Flow<String> = _insufficientEvent.receiveAsFlow()

    private val _snackbar = Channel<String>(Channel.BUFFERED)
    val snackbar: Flow<String> = _snackbar.receiveAsFlow()

    // --- Premium (synced from Worker) ---
    private val _isPremium = MutableStateFlow(false)
    val isPremium: StateFlow<Boolean> = _isPremium

    // --- Daily reward streak state ---
    private val _dailyReward = MutableStateFlow(
        DailyRewards.Claim(points = 200, streak = 0, claimedToday = false)
    )
    val dailyRewardState: StateFlow<DailyRewards.Claim> = _dailyReward

    /** Refresh premium status from the Worker for the given user id. */
    fun checkPremium(uid: String?) {
        val id = uid ?: return
        viewModelScope.launch {
            val status = com.aaa.ai.data.PromoManager.premium(appContext, id)
            _isPremium.value = status?.premium ?: false
        }
    }

    /** Redeem a promo code; grants premium time and refreshes premium state. */
    fun redeemPromo(code: String) {
        val id = _userId.value ?: return
        viewModelScope.launch {
            val res = com.aaa.ai.data.PromoManager.redeem(appContext, id, code)
            if (res.ok) {
                _isPremium.value = true
                _snackbar.send("🎉 Code accepted! +${res.premiumDays} days Premium unlocked.")
            } else {
                _snackbar.send(res.error ?: "Invalid or expired code.")
            }
        }
    }

    fun costFor(endpoint: ApiEndpoint): Int = ApiCost.forEndpoint(endpoint.id)
    fun kindFor(endpoint: ApiEndpoint): ResultKind = ApiCost.kindFor(endpoint.id)

    fun rewardForAd() {
        viewModelScope.launch {
            // Daily streak bonus: reward grows the more consecutive days the user returns.
            val pts = com.aaa.ai.data.DailyRewards.claim(appContext)
            val uid = _userId.value
            if (uid != null) {
                val bal = backend.addPoints(uid, pts, "ad")
                if (bal != null) _serverPoints.value = bal
            } else {
                pointsManager.addPoints(pts, "ad")
            }
            UserProfile.addLifetime(appContext, pts.toLong())
            AnalyticsLogger.logAdWatched(appContext)
            AnalyticsLogger.logPointsEarned(pts, "ad")
            _snackbar.send("+$pts Points added! 🔥")
            _dailyReward.value = DailyRewards.state(appContext)
                .first()
        }
    }

    /** Whether a daily login bonus is available to claim today. */
    val canClaimDaily: Flow<Boolean> = pointsManager.canClaimDailyFlow
    /** Current consecutive-day login streak. */
    val streak: Flow<Int> = pointsManager.streakFlow

    /** Claim the once-per-day streak bonus and reflect it in points + lifetime. */
    fun claimDailyBonus() {
        viewModelScope.launch {
            val result = pointsManager.claimDailyBonus()
            if (result.claimed) {
                UserProfile.addLifetime(appContext, result.amount.toLong())
                AnalyticsLogger.logPointsEarned(result.amount, "daily-streak")
                _snackbar.send("Daily bonus: +${result.amount} pts · ${result.streak}-day streak!")
            } else {
                _snackbar.send("Daily bonus already claimed today.")
            }
        }
    }

    private val _referralCount = MutableStateFlow(0)
    /** Lifetime successful invites (from the server). */
    val referralCount: StateFlow<Int> = _referralCount

    /** Personal Telegram invite link for the given Telegram chat id. */
    fun referralLink(chatId: String?): String = com.aaa.ai.data.ReferralManager.referralLink(chatId)

    /**
     * Sync referral rewards: claim any queued points from the server and credit
     * them locally. Safe to call on app open / when opening the Profile screen.
     */
    fun syncReferrals(chatId: String?) {
        val id = chatId?.filter { it.isDigit() }.orEmpty()
        if (id.isBlank()) return
        viewModelScope.launch {
            val status = com.aaa.ai.data.ReferralManager.check(appContext, id)
            if (status != null) _referralCount.value = status.count
            if (status != null && status.pending > 0) {
                val claimed = com.aaa.ai.data.ReferralManager.claim(appContext, id)
                if (claimed > 0) {
                    val uid = _userId.value
                    if (uid != null) {
                        val bal = backend.addPoints(uid, claimed, "referral")
                        if (bal != null) _serverPoints.value = bal
                    } else {
                        pointsManager.addPoints(claimed, "referral")
                    }
                    UserProfile.addLifetime(appContext, claimed.toLong())
                    AnalyticsLogger.logPointsEarned(claimed, "referral")
                    _snackbar.send("Referral reward: +$claimed pts! Thanks for inviting friends.")
                }
            }
        }
    }

    /** Selected AI model for the in-app chat (Gemini / Groq / HF). Null = use the
     * free felix endpoint selected in the dropdown. When set, chat goes through the
     * Worker's server-side router that uses the owner's provider keys. */
    val chatProvider = MutableStateFlow<com.aaa.ai.data.ChatApi.Model?>(null)

    // ---------- Chat ----------
    fun loadChatFor(endpoint: ApiEndpoint) {
        activeChatEndpoint = endpoint.id
        viewModelScope.launch {
            com.aaa.ai.data.ChatHistory.load(appContext, endpoint.id).collect { _chatMessages.value = it }
        }
    }

    fun sendChat(endpoint: ApiEndpoint, input: String) {
        val text = input.trim()
        if (text.isEmpty()) return
        val userMsg = ChatMessage(text, true, System.currentTimeMillis(), endpoint.id)
        _chatMessages.value = _chatMessages.value + userMsg
        viewModelScope.launch { com.aaa.ai.data.ChatHistory.append(appContext, endpoint.id, userMsg) }

        val model = chatProvider.value
        if (model != null) {
            // Server-side model (owner keys, auto-fallback). No felix cost.
            viewModelScope.launch {
                _isTyping.value = true
                val reply = com.aaa.ai.data.ChatApi.ask(appContext, model, text)
                _isTyping.value = false
                val ai = ChatMessage(
                    reply ?: "Ari couldn't reach the AI service. Try again or switch the model.",
                    false, System.currentTimeMillis(), endpoint.id
                )
                _chatMessages.value = _chatMessages.value + ai
                com.aaa.ai.data.ChatHistory.append(appContext, endpoint.id, ai)
            }
            return
        }

        val cost = costFor(endpoint)
        viewModelScope.launch {
            if (!preDeduct(endpoint, cost)) return@launch

            _isTyping.value = true
            when (val res = repository.fetchEndpoint(endpoint, text)) {
                is ApiResponse.Success -> {
                    val body = when (val p = res.parsed) {
                        is ParsedResult.Chat -> p.text
                        is ParsedResult.TextBlock -> p.body
                        is ParsedResult.Image -> p.url
                        is ParsedResult.List -> p.items.joinToString("\n") { it.title ?: it.body ?: "" }
                    }
                    val ai = ChatMessage(body, false, System.currentTimeMillis(), endpoint.id)
                    _chatMessages.value = _chatMessages.value + ai
                    com.aaa.ai.data.ChatHistory.append(appContext, endpoint.id, ai)
                }
                is ApiResponse.Error -> {
                    // Offline / no-backend fallback: show demo content so the UI stays usable.
                    val demo = repository.demoResponse(endpoint, text)
                    if (demo is ApiResponse.Success) {
                        val p = demo.parsed
                        val body = when (p) {
                            is ParsedResult.Chat -> p.text
                            is ParsedResult.TextBlock -> p.body
                            is ParsedResult.Image -> p.url
                            is ParsedResult.List -> p.items.joinToString("\n") { it.title ?: it.body ?: "" }
                        }
                        val ai = ChatMessage(body, false, System.currentTimeMillis(), endpoint.id)
                        _chatMessages.value = _chatMessages.value + ai
                        com.aaa.ai.data.ChatHistory.append(appContext, endpoint.id, ai)
                    } else {
                        val err = ChatMessage("Error: ${res.message}", false, System.currentTimeMillis(), endpoint.id)
                        _chatMessages.value = _chatMessages.value + err
                        com.aaa.ai.data.ChatHistory.append(appContext, endpoint.id, err)
                    }
                }
            }
            _isTyping.value = false
        }
    }

    // ---------- Gallery / Text ----------
    fun runEndpoint(endpoint: ApiEndpoint, param: String) {
        val cost = costFor(endpoint)
        viewModelScope.launch {
            if (!preDeduct(endpoint, cost)) return@launch
            _isLoading.value = true
            when (val res = repository.fetchEndpoint(endpoint, param)) {
                is ApiResponse.Success -> _result.value = res.parsed
                is ApiResponse.Error -> {
                    val demo = repository.demoResponse(endpoint, param)
                    if (demo is ApiResponse.Success) _result.value = demo.parsed
                    else _snackbar.send("Error: ${res.message}")
                }
            }
            _isLoading.value = false
        }
    }

    fun clearResult() { _result.value = null }

    /** Deduct cost; emit insufficient event + analytics if too low. Returns success. */
    private suspend fun preDeduct(endpoint: ApiEndpoint, cost: Int): Boolean {
        val uid = _userId.value
        val newBalance = if (uid != null) backend.spendPoints(uid, cost, endpoint.id)
        else if (pointsManager.deductPoints(cost, endpoint.id)) pointsManager.currentBalance() else null
        val ok = newBalance != null
        if (ok) {
            if (uid != null) _serverPoints.value = newBalance
            AnalyticsLogger.logPointsSpent(cost, endpoint.id)
            AnalyticsLogger.logEndpointUsed(endpoint.id)
        } else {
            _insufficientEvent.send(endpoint.id)
            AnalyticsLogger.logInsufficient(endpoint.id)
        }
        return ok
    }

    companion object {
        const val REWARD_PER_AD = 200
    }

    // NOTE: init runs AFTER all property initializers above (Kotlin semantics),
    // so every MutableStateFlow is already constructed when this coroutine fires.
    init {
        // Seed the daily-reward streak state so the UI can show it immediately.
        // Guarded so a read failure can never crash startup.
        viewModelScope.launch {
            runCatching { _dailyReward.value = DailyRewards.state(appContext).first() }
        }
    }
}
