package com.aaa.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aaa.ai.data.ApiCost
import com.aaa.ai.data.ApiEndpoint
import com.aaa.ai.data.ApiRepository
import com.aaa.ai.data.PointsManager
import com.aaa.ai.data.model.ApiResponse
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class MainViewModel(
    private val pointsManager: PointsManager,
    private val repository: ApiRepository
) : ViewModel() {

    /** Reactive points balance (defaults to 100 via PointsManager). */
    val userPoints: StateFlow<Int> = pointsManager.pointsFlow.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = PointsManager.DEFAULT_BALANCE
    )

    private val _response = MutableStateFlow<String>("Ready.")
    val response: StateFlow<String> = _response

    private val _lastImageUrl = MutableStateFlow<String?>(null)
    val lastImageUrl: StateFlow<String?> = _lastImageUrl

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    fun costFor(endpoint: ApiEndpoint): Int = ApiCost.forEndpoint(endpoint.id)

    fun rewardForAd() {
        viewModelScope.launch { pointsManager.addPoints(REWARD_PER_AD) }
    }

    /**
     * Deduct the endpoint's cost, then execute the network call.
     * If balance is insufficient, the call is intercepted and the UI is updated
     * with the required message.
     */
    fun handleUserAction(endpoint: ApiEndpoint, param: String) {
        viewModelScope.launch {
            val cost = costFor(endpoint)
            val allowed = pointsManager.deductPoints(cost)
            if (!allowed) {
                _response.value =
                    "Insufficient point balance. Please click 'Earn Points' above."
                _lastImageUrl.value = null
                return@launch
            }

            _isLoading.value = true
            _response.value = "Processing ${endpoint.name} securely..."
            _lastImageUrl.value = null

            when (val result: ApiResponse = repository.fetchEndpoint(endpoint, param)) {
                is ApiResponse.Success -> {
                    if (result.isGallery && result.rawUrl != null) {
                        _lastImageUrl.value = result.rawUrl
                        _response.value = "Image loaded from gallery."
                    } else if (result.rawUrl != null && looksLikeImage(result.rawUrl)) {
                        _lastImageUrl.value = result.rawUrl
                        _response.value = result.body
                    } else {
                        _response.value = result.body
                    }
                }
                is ApiResponse.Error -> {
                    _response.value = "Execution error: ${result.message}"
                }
            }
            _isLoading.value = false
        }
    }

    private fun looksLikeImage(url: String): Boolean =
        url.matches(Regex(".*\\.(jpg|jpeg|png|webp|gif)(\\?.*)?$", RegexOption.IGNORE_CASE))

    companion object {
        const val REWARD_PER_AD = 200
        const val INSUFFICIENT_MESSAGE =
            "Insufficient point balance. Please click 'Earn Points' above."
    }
}
