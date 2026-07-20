package com.aaa.ai.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

// Super AI refreshed brand — calm, premium, light-first.
// Ocean blue + teal + warm slate. No purple/pink.
val BrandBlue = Color(0xFF1565F0)      // primary ocean blue
val BrandBlueDeep = Color(0xFF0B4FD6)
val BrandTeal = Color(0xFF00B8A9)       // fresh teal accent
val BrandCyan = Color(0xFF19C3E6)
val BrandSlate = Color(0xFF334155)      // slate text
val BrandAmber = Color(0xFFF5A623)      // warm highlight

private val LightPrimary = BrandBlue
private val LightSecondary = BrandTeal
private val LightTertiary = BrandCyan
private val LightBackground = Color(0xFFF5F8FC)   // soft cool white
private val LightSurface = Color(0xFFFFFFFF)
private val LightOnSurface = Color(0xFF16233A)    // deep navy text

private val DarkPrimary = BrandCyan
private val DarkSecondary = BrandTeal
private val DarkTertiary = BrandBlue
private val DarkBackground = Color(0xFF0E1626)
private val DarkSurface = Color(0xFF16223A)
private val DarkOnSurface = Color(0xFFE8EEF7)

fun aaaLightColorScheme() = lightColorScheme(
    primary = LightPrimary,
    onPrimary = Color.White,
    primaryContainer = LightPrimary.copy(alpha = 0.12f),
    onPrimaryContainer = LightPrimary,
    secondary = LightSecondary,
    onSecondary = Color.White,
    tertiary = LightTertiary,
    background = LightBackground,
    onBackground = LightOnSurface,
    surface = LightSurface,
    onSurface = LightOnSurface,
    surfaceVariant = Color(0xFFEAF0F8),
    onSurfaceVariant = Color(0xFF5A6B85),
    outline = Color(0xFFD3DEEC)
)

fun aaaDarkColorScheme() = darkColorScheme(
    primary = DarkPrimary,
    onPrimary = Color(0xFF06243A),
    primaryContainer = DarkPrimary.copy(alpha = 0.18f),
    secondary = DarkSecondary,
    onSecondary = Color.White,
    tertiary = DarkTertiary,
    background = DarkBackground,
    onBackground = DarkOnSurface,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
    surfaceVariant = Color(0xFF22304D),
    onSurfaceVariant = Color(0xFFAEBED6),
    outline = Color(0xFF2C3C5C)
)
