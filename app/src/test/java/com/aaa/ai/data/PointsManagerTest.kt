package com.aaa.ai.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import com.aaa.ai.data.PointsManager.Companion
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class PointsManagerTest {

    private lateinit var manager: PointsManager
    private lateinit var context: Context

    @Before
    fun setup() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        // Reset persisted store so each test starts from a clean 100-point balance.
        context.dataStore.edit { it.clear() }
        manager = PointsManager(context)
    }

    @Test
    fun defaultBalanceIs100() = runBlocking {
        assertEquals(100, manager.pointsFlow.first())
    }

    @Test
    fun addPoints_increments() = runBlocking {
        manager.addPoints(200)
        assertEquals(300, manager.pointsFlow.first())
    }

    @Test
    fun deductPoints_succeedsWhenEnough() = runBlocking {
        manager.addPoints(50)
        val ok = manager.deductPoints(30)
        assertTrue(ok)
        assertEquals(120, manager.pointsFlow.first()) // 100 + 50 - 30
    }

    @Test
    fun deductPoints_failsWhenInsufficient() = runBlocking {
        manager.addPoints(100) // 200 total
        assertTrue(manager.deductPoints(100)) // -> 100
        assertEquals(100, manager.pointsFlow.first())
        assertFalse(manager.deductPoints(101)) // can't go below 0
        assertEquals(100, manager.pointsFlow.first())
    }
}
