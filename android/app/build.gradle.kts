plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.blog"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.example.blog"
        minSdk = 26
        targetSdk = 36
        versionCode = 11
        versionName = "2.2.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // 原生 Markdown 渲染（正文阅读器）：core + 删除线 + 表格 + 图片
    val markwon = "4.6.2"
    implementation("io.noties.markwon:core:$markwon")
    implementation("io.noties.markwon:ext-strikethrough:$markwon")
    implementation("io.noties.markwon:ext-tables:$markwon")
    implementation("io.noties.markwon:image:$markwon")
}
