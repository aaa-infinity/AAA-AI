package com.aaa.ai.data

import com.aaa.ai.data.model.ChatMessage
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * Cloud backend (Firestore) for the signed-in user.
 *
 * Structure:
 *   users/{uid}                 -> { points, email, displayName, photoURL, createdAt }
 *   users/{uid}/history/{id}    -> chat / gallery / text entries
 *   users/{uid}/transactions/{id} -> points earn/spend log
 *
 * When no user is signed in, the caller should fall back to the local
 * [PointsManager] / [ChatHistory] (DataStore) implementations.
 */
class FirestoreBackend(private val db: FirebaseFirestore) {

    fun userDoc(uid: String) = db.collection("users").document(uid)
    fun historyCol(uid: String) = userDoc(uid).collection("history")
    fun txCol(uid: String) = userDoc(uid).collection("transactions")

    /** Create/refresh the user profile document. Safe to call repeatedly. */
    suspend fun ensureProfile(user: FirebaseUser) {
        val doc = userDoc(user.uid)
        val snap = doc.get().await()
        if (!snap.exists()) {
            val data = mapOf(
                "points" to PointsManager.DEFAULT_BALANCE,
                "email" to (user.email ?: ""),
                "displayName" to (user.displayName ?: ""),
                "photoURL" to (user.photoUrl?.toString() ?: ""),
                "createdAt" to FieldValue.serverTimestamp()
            )
            doc.set(data).await()
        } else {
            val patch = mutableMapOf<String, Any>()
            if (snap.getString("email").isNullOrEmpty() && !user.email.isNullOrEmpty())
                patch["email"] = user.email!!
            if (snap.getString("displayName").isNullOrEmpty() && !user.displayName.isNullOrEmpty())
                patch["displayName"] = user.displayName!!
            if (patch.isNotEmpty()) doc.update(patch).await()
        }
    }

    /** Reactive points balance for a user. */
    fun pointsFlow(uid: String): Flow<Int> = callbackFlow {
        val reg = userDoc(uid).addSnapshotListener { snap, _ ->
            val pts = snap?.getLong("points")?.toInt() ?: PointsManager.DEFAULT_BALANCE
            trySend(pts)
        }
        awaitClose { reg.remove() }
    }

    /** Add points (earn). Returns the new balance. */
    suspend fun addPoints(uid: String, amount: Int, reason: String): Int {
        val ref = userDoc(uid)
        return db.runTransaction { txn ->
            val snap = txn.get(ref)
            val current = snap.getLong("points")?.toInt() ?: PointsManager.DEFAULT_BALANCE
            val next = current + amount
            txn.update(ref, "points", next)
            // append a transaction log entry
            val log = txCol(uid).document()
            txn.set(log, mapOf(
                "type" to "earn",
                "amount" to amount,
                "reason" to reason,
                "timeMillis" to System.currentTimeMillis()
            ))
            next
        }.await()
    }

    /**
     * Spend points. Returns true on success (and updates balance + log),
     * false if the balance is insufficient (no writes performed).
     */
    suspend fun spendPoints(uid: String, amount: Int, reason: String): Boolean {
        val ref = userDoc(uid)
        return try {
            db.runTransaction { txn ->
                val snap = txn.get(ref)
                val current = snap.getLong("points")?.toInt() ?: PointsManager.DEFAULT_BALANCE
                if (current < amount) {
                    throw InsufficientException()
                }
                txn.update(ref, "points", current - amount)
                val log = txCol(uid).document()
                txn.set(log, mapOf(
                    "type" to "spend",
                    "amount" to amount,
                    "reason" to reason,
                    "timeMillis" to System.currentTimeMillis()
                ))
            }.await()
            true
        } catch (e: InsufficientException) {
            false
        }
    }

    /** Append a chat/gallery/text history entry. */
    suspend fun appendHistory(uid: String, msg: ChatMessage) {
        historyCol(uid).add(
            mapOf(
                "endpointId" to msg.endpointId,
                "text" to msg.text,
                "isUser" to msg.isUser,
                "timestamp" to msg.timestamp
            )
        ).await()
    }

    /** Live history, newest first (capped). */
    fun historyFlow(uid: String): Flow<List<ChatMessage>> = callbackFlow {
        val reg = historyCol(uid)
            .orderBy("timestamp", Query.Direction.ASCENDING)
            .limit(500)
            .addSnapshotListener { snap, _ ->
                val list = snap?.documents?.mapNotNull { d ->
                    val endpoint = d.getString("endpointId").orEmpty()
                    val text = d.getString("text").orEmpty()
                    val isUser = d.getBoolean("isUser") ?: false
                    val ts = d.getLong("timestamp") ?: 0
                    ChatMessage(text, isUser, ts, endpoint)
                } ?: emptyList()
                trySend(list)
            }
        awaitClose { reg.remove() }
    }

    fun transactionsFlow(uid: String): Flow<List<PointsTransaction>> = callbackFlow {
        val reg = txCol(uid)
            .orderBy("timeMillis", Query.Direction.DESCENDING)
            .limit(200)
            .addSnapshotListener { snap, _ ->
                val list = snap?.documents?.mapNotNull { d ->
                    val type = d.getString("type").orEmpty()
                    val amount = d.getLong("amount")?.toInt() ?: 0
                    val reason = d.getString("reason").orEmpty()
                    val ts = d.getLong("timeMillis") ?: 0
                    PointsTransaction(type, amount, reason, ts)
                } ?: emptyList()
                trySend(list)
            }
        awaitClose { reg.remove() }
    }

    private class InsufficientException : Exception()
}
