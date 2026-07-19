package com.aaa.ai.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Sideload auto-update: since the app is distributed outside the Play Store, it
 * polls the Cloudflare Worker `/api/app-version` for a newer build and lets the
 * user open the download page / APK. The server manifest is KV-driven so a new
 * version can be announced without redeploying the Worker.
 */
object UpdateChecker {

    data class UpdateInfo(
        val versionCode: Int,
        val versionName: String,
        val required: Boolean,
        val changelog: String,
        val downloadUrl: String,
        val pageUrl: String
    )

    /** Returns update info only if a strictly newer version is available, else null. */
    suspend fun check(context: Context): UpdateInfo? = withContext(Dispatchers.IO) {
        runCatching {
            val base = context.getString(com.aaa.ai.R.string.bot_server_url).trimEnd('/')
            val conn = URL("$base/api/app-version").openConnection() as HttpURLConnection
            conn.requestMethod = "GET"; conn.connectTimeout = 12000; conn.readTimeout = 12000
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()
            val json = JSONObject(body)
            if (!json.optBoolean("ok")) return@runCatching null
            val latest = json.optInt("versionCode", 0)
            val current = currentVersionCode(context)
            // If we can't determine the current version (0), never prompt — a
            // false "update available" is worse than a missed one.
            if (current == 0) return@runCatching null
            if (latest <= current) return@runCatching null
            UpdateInfo(
                versionCode = latest,
                versionName = json.optString("versionName"),
                required = json.optBoolean("required", false),
                changelog = json.optString("changelog"),
                downloadUrl = json.optString("downloadUrl"),
                pageUrl = json.optString("pageUrl")
            )
        }.getOrNull()
    }

    fun currentVersionCode(context: Context): Int = runCatching {
        val pkg = context.packageManager.getPackageInfo(context.packageName, 0)
        @Suppress("DEPRECATION")
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P)
            pkg.longVersionCode.toInt() else pkg.versionCode
    }.getOrDefault(0)

    /**
     * Download the new APK to app cache and launch the system package installer.
     * Because the new build shares applicationId + signing key and has a higher
     * versionCode, Android performs an in-place update (old version is replaced).
     * Falls back to opening the download page in a browser on any failure.
     */
    suspend fun downloadAndInstall(context: Context, info: UpdateInfo): Boolean = withContext(Dispatchers.IO) {
        // Android O+ requires the app to be permitted to install packages.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            openInstallSettings(context)
            return@withContext false
        }
        val ok = runCatching {
            val dir = File(context.cacheDir, "downloads").apply { mkdirs() }
            val apk = File(dir, "aaa-ai-update.apk")
            if (apk.exists()) apk.delete()
            val conn = URL(info.downloadUrl).openConnection() as HttpURLConnection
            conn.connectTimeout = 20000; conn.readTimeout = 60000
            conn.inputStream.use { input -> apk.outputStream().use { input.copyTo(it) } }
            conn.disconnect()
            if (apk.length() <= 0L) return@runCatching false
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        }.getOrDefault(false)
        if (!ok) openDownloadPage(context, info)
        ok
    }

    /** Open the "install unknown apps" settings screen for this app. */
    fun openInstallSettings(context: Context) {
        runCatching {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                val intent = Intent(
                    android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}")
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            }
        }
    }

    /** Fallback: open the download landing page in a browser. */
    fun openDownloadPage(context: Context, info: UpdateInfo) {
        val url = info.pageUrl.ifBlank { info.downloadUrl }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
    }
}
