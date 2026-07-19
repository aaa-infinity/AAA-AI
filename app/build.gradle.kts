import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
    id("com.google.firebase.crashlytics")
}

android {
    namespace = "com.aaa.ai"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.aaa.ai"
        minSdk = 24
        targetSdk = 35
        versionCode = 17
        versionName = "2.2.9"

        // Load APP_SHARED_SECRET from local.properties (gitignored) so the secret
        // is never baked into source control or the public APK's source.
        val localProps = Properties().apply {
            val f = rootProject.file("local.properties")
            if (f.exists()) FileInputStream(f).use { load(it) }
        }
        val sharedSecret = localProps.getProperty("APP_SHARED_SECRET")
            ?: providers.gradleProperty("APP_SHARED_SECRET").orNull
            ?: ""
        buildConfigField("String", "APP_SHARED_SECRET", "\"$sharedSecret\"")

        // Telegram user-account API credentials (from your my.telegram.org app).
        // These are PUBLIC client credentials (Telegram ships them in the app),
        // so they safely default to the project's values. Overridable via
        // local.properties / gradle properties / CI secret if you ever rotate them.
        val tgApiId = localProps.getProperty("TG_API_ID")
            ?: providers.gradleProperty("TG_API_ID").orNull ?: "37321306"
        val tgApiHash = localProps.getProperty("TG_API_HASH")
            ?: providers.gradleProperty("TG_API_HASH").orNull ?: "5cd9e5bbfb572a4429a0c54774153b47"
        buildConfigField("int", "TG_API_ID", if (tgApiId.isBlank()) "0" else tgApiId)
        buildConfigField("String", "TG_API_HASH", "\"$tgApiHash\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
        ndk {
            // ARM-only ABIs: covers 99% of real Android phones/tablets. Dropping
            // x86/x86_64 avoids native-lib packaging conflicts and large APKs that
            // can crash on launch on some devices. (Emulators can use ARM images.)
            abiFilters += listOf("armeabi-v7a", "arm64-v8a")
        }
    }

    signingConfigs {
        create("release") {
            // Gradle does not auto-expose custom local.properties keys as gradle
            // properties, so load them explicitly from local.properties.
            val localProps = Properties().apply {
                val f = rootProject.file("local.properties")
                if (f.exists()) FileInputStream(f).use { load(it) }
            }
            val storeFileProp = localProps.getProperty("RELEASE_STORE_FILE")
                ?: providers.gradleProperty("RELEASE_STORE_FILE").orNull
            val storePasswordProp = localProps.getProperty("RELEASE_STORE_PASSWORD")
                ?: providers.gradleProperty("RELEASE_STORE_PASSWORD").orNull
            val keyAliasProp = localProps.getProperty("RELEASE_KEY_ALIAS")
                ?: providers.gradleProperty("RELEASE_KEY_ALIAS").orNull
            val keyPasswordProp = localProps.getProperty("RELEASE_KEY_PASSWORD")
                ?: providers.gradleProperty("RELEASE_KEY_PASSWORD").orNull
            if (storeFileProp != null && storePasswordProp != null && keyAliasProp != null && keyPasswordProp != null) {
                storeFile = file("${projectDir}/$storeFileProp")
                storePassword = storePasswordProp
                keyAlias = keyAliasProp
                keyPassword = keyPasswordProp
            }
        }
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
}

// TDLib (Telegram USER-account login) is OPTIONAL: it needs the official native
// AAR which is not on Maven Central. Drop `tdlib.aar` into app/libs/ and the
// tdlib source set compiles + the feature activates. Without it, the app still
// builds and runs (the user-account login button is hidden).
val tdlibAar = file("libs/tdlib.aar")
if (tdlibAar.exists()) {
    sourceSets.getByName("main") {
        java.srcDir("src/tdlib/java")
    }
}

dependencies {
    if (tdlibAar.exists()) {
        implementation(files(tdlibAar))
    }
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.datastore.preferences)
    implementation(libs.coil.compose)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.analytics)
    implementation(libs.firebase.crashlytics)
    implementation(libs.firebase.config)
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.google.android.auth)
    implementation(libs.google.play.services.ads)

    // Heavy media / ML / UI libs -> app install size lands in the 100-300MB range.
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    implementation(libs.mlkit.text.recognition)
    implementation(libs.tensorflow.lite)
    implementation(libs.tensorflow.lite.gpu)
    implementation(libs.onnxruntime.android)
    implementation(libs.coil.gif)
    implementation(libs.lottie.compose)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.exoplayer.dash)
    implementation(libs.media3.ui)
    implementation(libs.androidx.lifecycle.viewmodel.savedstate)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.core.splashscreen)

    debugImplementation(libs.androidx.ui.tooling)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(libs.androidx.junit)
    testImplementation(libs.mockk)
    testImplementation(libs.robolectric)
    testImplementation(libs.truth)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
