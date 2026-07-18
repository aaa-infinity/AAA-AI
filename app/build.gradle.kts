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
        versionCode = 12
        versionName = "2.2.5"

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

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
        ndk {
            // Universal support: build for ALL common Android ABIs so the app
            // installs on phones (ARM), Android emulators, Chrome OS and Intel
            // tablets (x86/x86_64) — not just ARM devices.
            abiFilters += listOf("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
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
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
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

dependencies {
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
