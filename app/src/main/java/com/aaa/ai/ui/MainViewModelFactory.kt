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
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore

@Suppress("UNCHECKED_CAST")
class MainViewModelFactory(private val application: Application) : ViewModelProvider.Factory {
    /** Returns a usable Firestore instance, or null when Firebase is unavailable
     *  (e.g. misconfigured build). Callers must tolerate a null backend so the
     *  app still runs in local-only mode instead of crashing on launch. */
    private fun firestoreOrNull(): FirebaseFirestore? = runCatching {
        if (FirebaseApp.getApps(application).isEmpty()) return@runCatching null
        FirebaseFirestore.getInstance()
    }.getOrNull()

    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        val store = firestoreOrNull()
        if (modelClass.isAssignableFrom(MainViewModel::class.java)) {
            return MainViewModel(
                pointsManager = PointsManager(application),
                backend = FirestoreBackend(store, application),
                repository = ApiRepository(),
                appContext = application
            ) as T
        }
        if (modelClass.isAssignableFrom(AuthViewModel::class.java)) {
            return AuthViewModel(
                auth = AuthRepository(application),
                backend = FirestoreBackend(store, application),
                appContext = application
            ) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
