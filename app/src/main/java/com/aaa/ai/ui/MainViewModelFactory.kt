package com.aaa.ai.ui

import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.aaa.ai.MainViewModel
import com.aaa.ai.data.ApiRepository
import com.aaa.ai.data.PointsManager

@Suppress("UNCHECKED_CAST")
class MainViewModelFactory(private val application: Application) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(MainViewModel::class.java)) {
            return MainViewModel(
                pointsManager = PointsManager(application),
                repository = ApiRepository()
            ) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
