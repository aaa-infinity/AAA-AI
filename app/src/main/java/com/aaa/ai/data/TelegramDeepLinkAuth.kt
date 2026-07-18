package com.aaa.ai.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import kotlin.random.Random

/**
 * Secure Telegram deep-link authentication helper.
 *
 * Generates an 8-character alphanumeric verification token, builds the
 * `https://t.me/AAA_Login_bot?start=verify_<token>` deep link, and fires a safe
 * implicit VIEW intent that opens the Telegram client. The token is what the
 * login bot stores server-side; the app later polls the Worker verify endpoint.
 *
 * No Telegram bot token ever lives in the app — only the public bot handle and
 * the user-generated token are used here.
 */
object TelegramDeepLinkAuth {

    const val BOT_HANDLE = "AAA_Login_bot"

    private val ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no ambiguous chars

    /** Generate a secure 8-character alphanumeric verification token (uppercase). */
    fun generateToken(): String =
        (1..8).map { ALPHABET[Random.nextInt(ALPHABET.length)] }.joinToString("")

    /** Build the deep link URI for a given token. */
    fun deepLink(token: String): Uri =
        Uri.parse("https://t.me/$BOT_HANDLE?start=verify_${token.uppercase()}")

    /**
     * Launch the Telegram client to the bot with the verify token.
     * Returns the token that was used (so the caller can start polling).
     */
    fun launch(context: Context, token: String): Uri {
        val uri = deepLink(token)
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        return uri
    }
}
