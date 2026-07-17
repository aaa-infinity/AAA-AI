package com.aaa.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aaa.ai.data.ApiCost
import com.aaa.ai.data.ApiEndpoint
import com.aaa.ai.data.ApiRepository
import com.aaa.ai.data.AnalyticsLogger
import com.aaa.ai.data.ChatHistory
import com.aaa.ai.data.PointsManager
import com.aaa.ai.data.ResultKind
import com.aaa.ai.data.model.ApiResponse
import com.aaa.ai.data.model.ChatMessage
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class MainViewModel(
    private val pointsManager: PointsManager,
    private val repository: ApiRepository,
    private val appContext: android.content.Context
) : ViewModel() {

    val userPoints: StateFlow<Int> = pointsManager.pointsFlow.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = PointsManager.DEFAULT_BALANCE
    )

    val transactions = pointsManager.transactionsFlow

    // --- Chat state ---
    private val _chatMessages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val chatMessages: StateFlow<List<ChatMessage>> = _chatMessages
    private val _isTyping = MutableStateFlow(false)
    val isTyping: StateFlow<Boolean> = _isTyping
    private var activeChatEndpoint: String = ""

    // --- Gallery / Text state ---
    private val _galleryUrl = MutableStateFlow<String?>(null)
    val galleryUrl: StateFlow<String?> = _galleryUrl
    private val _toolText = MutableStateFlow<String?>(null)
    val toolText: StateFlow<String?> = _toolText
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    // --- One-shot events ---
    private val _insufficientEvent = Channel<String>(Channel.BUFFERED)
    val insufficientEvent: Flow<String> = _insufficientEvent.receiveAsFlow()

    private val _snackbar = Channel<String>(Channel.BUFFERED)
    val snackbar: Flow<String> = _snackbar.receiveAsFlow()

    fun costFor(endpoint: ApiEndpoint): Int = ApiCost.forEndpoint(endpoint.id)
    fun kindFor(endpoint: ApiEndpoint): ResultKind = ApiCost.kindFor(endpoint.id)

    fun rewardForAd() {
        viewModelScope.launch {
            pointsManager.addPoints(REWARD_PER_AD, "ad")
            AnalyticsLogger.logAdWatched(appContext)
            AnalyticsLogger.logPointsEarned(REWARD_PER_AD, "ad")
            _snackbar.send("+200 Points added!")
        }
    }

    // ---------- Chat ----------
    fun loadChatFor(endpoint: ApiEndpoint) {
        activeChatEndpoint = endpoint.id
        viewModelScope.launch {
            ChatHistory.load(appContext, endpoint.id).collect { _chatMessages.value = it }
        }
    }

    fun sendChat(endpoint: ApiEndpoint, input: String) {
        val text = input.trim()
        if (text.isEmpty()) return
        val userMsg = ChatMessage(text, true, System.currentTimeMillis(), endpoint.id)
        _chatMessages.value = _chatMessages.value + userMsg
        viewModelScope.launch { ChatHistory.append(appContext, endpoint.id, userMsg) }

        val cost = costFor(endpoint)
        viewModelScope.launch {
            if (!preDeduct(endpoint, cost)) return@launch

            _isTyping.value = true
            when (val result = repository.fetchEndpoint(endpoint, text)) {
                is ApiResponse.Success -> {
                    val ai = ChatMessage(result.body, false, System.currentTimeMillis(), endpoint.id)
                    _chatMessages.value = _chatMessages.value + ai
                    ChatHistory.append(appContext, endpoint.id, ai)
                }
                is ApiResponse.Error -> {
                    val err = ChatMessage("Error: ${result.message}", false, System.currentTimeMillis(), endpoint.id)
                    _chatMessages.value = _chatMessages.value + err
                    ChatHistory.append(appContext, endpoint.id, err)
                }
            }
            _isTyping.value = false
        }
    }

    // ---------- Gallery ----------
    fun loadGallery(endpoint: ApiEndpoint, param: String) {
        val cost = costFor(endpoint)
        viewModelScope.launch {
            if (!preDeduct(endpoint, cost)) return@launch
            _isLoading.value = true
            _toolText.value = null
            when (val result = repository.fetchEndpoint(endpoint, param)) {
                is ApiResponse.Success -> _galleryUrl.value = result.rawUrl ?: result.body
                is ApiResponse.Error -> _snackbar.send("Error: ${result.message}")
            }
            _isLoading.value = false
        }
    }

    fun clearGallery() { _galleryUrl.value = null }

    // ---------- Text tool ----------
    fun runTextTool(endpoint: ApiEndpoint, param: String) {
        val cost = costFor(endpoint)
        viewModelScope.launch {
            if (!preDeduct(endpoint, cost)) return@launch
            _isLoading.value = true
            _galleryUrl.value = null
            when (val result = repository.fetchEndpoint(endpoint, param)) {
                is ApiResponse.Success -> _toolText.value = result.body
                is ApiResponse.Error -> _snackbar.send("Error: ${result.message}")
            }
            _isLoading.value = false
        }
    }

    fun clearTextTool() { _toolText.value = null }

    /** Deduct cost; emit insufficient event + analytics if too low. Returns success. */
    private suspend fun preDeduct(endpoint: ApiEndpoint, cost: Int): Boolean {
        val ok = pointsManager.deductPoints(cost, endpoint.id)
        if (ok) {
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
}
