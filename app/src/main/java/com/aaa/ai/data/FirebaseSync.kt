package com.aaa.ai.data

import android.content.Context
import android.util.Log
import com.google.firebase.auth.FirebaseUser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume

/**
 * Mirrors a Firebase-authenticated user into the Cloudflare gateway, which in
 * turn writes the user into the Supabase Postgres `users` mirror and the D1
 * wallet. This is the glue that connects Firebase (live auth backend) with
 * Supabase (relational admin/analytics store) behind the Cloudflare Worker.
 *
 * Called once after every successful Firebase sign-in. Fire-and-forget: any
 * failure is logged but never blocks the UI.
 */
object FirebaseSync {

    private const val TAG = "FirebaseSync"

    private fun base(context: Context): String =
        context.getString(com.aaa.ai.R.string.bot_server_url).trimEnd('/')

    /** Push the current Firebase user's ID token to /api/firebase-sync. */
    suspend fun sync(context: Context, user: FirebaseUser) = withContext(Dispatchers.IO) {
        runCatching {
            val token = suspendCancellableCoroutine<String?> { cont ->
                user.getIdToken(false).addOnCompleteListener { task ->
                    cont.resume(task.result?.token)
                }
            } ?: return@runCatching
            val conn = URL("${base(context)}/api/firebase-sync").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            conn.setRequestProperty("x-app-secret", com.aaa.ai.BuildConfig.APP_SHARED_SECRET)
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            val body = JSONObject().apply { put("idToken", token) }.toString()
            conn.outputStream.use { it.write(body.toByteArray()) }
            val code = conn.responseCode
            val raw = if (code in 200..299) {
                conn.inputStream.bufferedReader().use { it.readText() }
            } else {
                conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
            }
            conn.disconnect()
            Log.d(TAG, "firebase-sync ($code): $raw")
        }.onFailure { Log.w(TAG, "firebase-sync failed", it) }
    }
}
