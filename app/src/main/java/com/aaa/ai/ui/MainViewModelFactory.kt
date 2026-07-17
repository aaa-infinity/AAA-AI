package com.aaa.ai.ui

import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.aaa.ai.AuthViewModel
import com.aaa.ai.MainViewModel
import com.aaa.ai.data.ApiRepository
import com.aaa.ai.data.AuthRepository
import com.aaa.ai.data.FirestoreBackend
import com.aaa.ai.data.PointsManager
import com.google.firebase.firestore.FirebaseFirestore

@Suppress("UNCHECKED_CAST")
class MainViewModelFactory(private val application: Application) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(MainViewModel::class.java)) {
            return MainViewModel(
                pointsManager = PointsManager(application),
                backend = FirestoreBackend(FirebaseFirestore.getInstance()),
                repository = ApiRepository(),
                appContext = application
            ) as T
        }
        if (modelClass.isAssignableFrom(AuthViewModel::class.java)) {
            return AuthViewModel(
                auth = AuthRepository(application),
                backend = FirestoreBackend(FirebaseFirestore.getInstance()),
                appContext = application
            ) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
