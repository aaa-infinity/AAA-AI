package com.aaa.ai.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

// Ari AI premium brand palette
val BrandPurple = Color(0xFF7C4DFF)
val BrandIndigo = Color(0xFF536DFE)
val BrandPink = Color(0xFFFF4D9D)
val BrandTeal = Color(0xFF1DE9B6)
val BrandAmber = Color(0xFFFFB300)

private val LightPrimary = BrandPurple
private val LightSecondary = BrandIndigo
private val LightTertiary = BrandPink
private val LightBackground = Color(0xFFF7F7FB)
private val LightSurface = Color(0xFFFFFFFF)
private val LightOnSurface = Color(0xFF1A1A2E)

private val DarkPrimary = BrandPurple
private val DarkSecondary = BrandIndigo
private val DarkTertiary = BrandPink
private val DarkBackground = Color(0xFF0E0E16)
private val DarkSurface = Color(0xFF1A1A28)
private val DarkOnSurface = Color(0xFFECECF5)

fun aaaLightColorScheme() = lightColorScheme(
    primary = LightPrimary,
    onPrimary = Color.White,
    primaryContainer = LightPrimary.copy(alpha = 0.14f),
    secondary = LightSecondary,
    onSecondary = Color.White,
    tertiary = LightTertiary,
    background = LightBackground,
    onBackground = LightOnSurface,
    surface = LightSurface,
    onSurface = LightOnSurface,
    surfaceVariant = Color(0xFFEFEFF5),
    onSurfaceVariant = Color(0xFF5A5A72),
    outline = Color(0xFFD8D8E4)
)

fun aaaDarkColorScheme() = darkColorScheme(
    primary = DarkPrimary,
    onPrimary = Color.White,
    primaryContainer = DarkPrimary.copy(alpha = 0.20f),
    secondary = DarkSecondary,
    onSecondary = Color.White,
    tertiary = DarkTertiary,
    background = DarkBackground,
    onBackground = DarkOnSurface,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
    surfaceVariant = Color(0xFF262538),
    onSurfaceVariant = Color(0xFFB6B6CC),
    outline = Color(0xFF33334A)
)
