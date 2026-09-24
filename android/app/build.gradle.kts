plugins {
    id("com.android.application")
}

android {
    namespace = "vn.lotusai.pos.cloudpilot"
    compileSdk = 35

    defaultConfig {
        applicationId = "vn.lotusai.pos.cloudpilot"
        minSdk = 23
        targetSdk = 35
        versionCode = 5
        versionName = "2.1.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation(files("libs/printerlibrary-1.0.18.aar"))
}
