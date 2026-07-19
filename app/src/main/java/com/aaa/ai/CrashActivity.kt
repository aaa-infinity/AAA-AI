package com.aaa.ai

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView
import java.io.File

/**
 * Displays the last fatal crash so the app never "silently closes" on launch.
 * Launched by [FirebaseApplication]'s global handler instead of letting Android
 * kill the process, so the user (and we) can read the real stack trace.
 */
class CrashActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val msg = intent.getStringExtra("message") ?: "Unknown crash"
        val stack = intent.getStringExtra("stack")
            ?: try {
                File(filesDir, "last_crash.txt").readText()
            } catch (_: Throwable) {
                "(no saved stack)"
            }

        val text = TextView(this).apply {
            text = "Super AI crashed on startup.\n\n${message}\n\n${stack}"
            setPadding(32, 32, 32, 32)
            textSize = 11f
            setTextIsSelectable(true)
        }
        setContentView(ScrollView(this).apply { addView(text) })
    }

    companion object {
        fun buildIntent(context: Context, message: String, stack: String): Intent =
            Intent(context, CrashActivity::class.java).apply {
                putExtra("message", message)
                putExtra("stack", stack)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
    }
}
