package com.aaa.ai.data

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.aaa.ai.MainActivity
import com.aaa.ai.R

/** Local (on-device) notifications for reward reminders and update prompts. */
object NotificationHelper {
    private const val CHANNEL_ID = "ari_ai_general"
    private const val CHANNEL_NAME = "Ari AI"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                val ch = NotificationChannel(
                    CHANNEL_ID, CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Ari AI reminders and updates"
                    setShowBadge(true)
                }
                mgr.createNotificationChannel(ch)
            }
        }
    }

    private fun contentIntent(context: Context): PendingIntent {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val intent = (launch ?: Intent(context, MainActivity::class.java)).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        return PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    fun notifyReward(context: Context) {
        ensureChannel(context)
        val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val note = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("🎁 Your daily reward is ready")
            .setContentText("Open Ari AI and tap Earn to grab +200 points.")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(contentIntent(context))
            .build()
        mgr.notify(1001, note)
    }

    fun notifyUpdate(context: Context, versionName: String) {
        ensureChannel(context)
        val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val note = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("⬆️ Ari AI $versionName is available")
            .setContentText("A new version is ready to download in the app.")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(contentIntent(context))
            .build()
        mgr.notify(1002, note)
    }
}
