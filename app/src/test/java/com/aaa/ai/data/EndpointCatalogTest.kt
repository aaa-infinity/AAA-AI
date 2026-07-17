package com.aaa.ai.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EndpointCatalogTest {

    @Test
    fun catalog_notEmpty() {
        assertTrue(EndpointCatalog.endpoints.isNotEmpty())
    }

    @Test
    fun idsAreUnique() {
        val ids = EndpointCatalog.endpoints.map { it.id }
        assertEquals(ids.size, ids.toSet().size)
    }

    @Test
    fun everyEndpointHasKnownCategory() {
        EndpointCatalog.endpoints.forEach {
            assertTrue(it.category in EndpointCatalog.categories)
        }
    }

    @Test
    fun buildUrl_encodesParam() {
        val ep = EndpointCatalog.endpoints.first { it.id == "gemini" }
        val url = ep.buildUrl(ApiEndpoint.BASE_URL, "hello world")
        assertTrue(url.startsWith(ApiEndpoint.BASE_URL + "/gemini?q="))
        assertTrue(url.contains("hello%20world"))
    }

    @Test
    fun urlKeyEndpointsUseUrlParam() {
        val yt = EndpointCatalog.endpoints.first { it.id == "ytv" }
        assertEquals("url", yt.paramKey)
    }
}
