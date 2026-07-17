# Add project-specific ProGuard rules here.
-keep public class com.aaa.ai.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Keep Compose / DataStore model classes
-keep class com.aaa.ai.data.** { *; }

# DataStore / Preferences
-keep class androidx.datastore.** { *; }
