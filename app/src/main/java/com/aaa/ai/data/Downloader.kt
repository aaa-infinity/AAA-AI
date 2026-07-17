package com.aaa.ai.data

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import java.io.File

/**
 * Saves an image URL to the public Pictures/AAA-AI directory using DownloadManager,
 * which works across all SDK levels without extra storage permissions on API 29+.
 *
 * @return a human-readable status message
 */
object Downloader {
    fun saveImage(context: Context, imageUrl: String, fileNameHint: String = "aaa-ai"): String {
        return try {
            val safeName = "${fileNameHint}_${System.currentTimeMillis()}.jpg"
                .replace(Regex("[^a-zA-Z0-9._-]"), "_")
            val dir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                "AAA-AI"
            )
            val request = DownloadManager.Request(Uri.parse(imageUrl))
                .setTitle("AAA-AI image")
                .setDescription("Saving to Pictures/AAA-AI")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(
                    Environment.DIRECTORY_PICTURES,
                    "AAA-AI/$safeName"
                )
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)

            val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(request)
            "Saving image to Pictures/AAA-AI…"
        } catch (e: Exception) {
            "Download failed: ${e.message}"
        }
    }
}
