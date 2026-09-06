plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.punarvapar.ewaste"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.punarvapar.ewaste"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "1.0"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            buildConfigField("String", "BACKEND_URL", "\"http://10.55.36.142:8000\"")
        }
        debug {
            buildConfigField("String", "BACKEND_URL", "\"http://10.55.36.142:8000\"")
        }
    }

    dependencies {
        implementation("androidx.core:core:1.15.0")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}
