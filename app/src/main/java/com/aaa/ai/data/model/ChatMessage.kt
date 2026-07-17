package com.aaa.ai.data.model

/**
 * A single chat message in a conversation.
 *
 * @param text       message content
 * @param isUser     true if sent by the local user, false if from the AI model
 * @param timestamp  epoch millis
 * @param endpointId id of the AI endpoint that produced an AI message (blank for user)
 */
data class ChatMessage(
    val text: String,
    val isUser: Boolean,
    val timestamp: Long = System.currentTimeMillis(),
    val endpointId: String = ""
)
