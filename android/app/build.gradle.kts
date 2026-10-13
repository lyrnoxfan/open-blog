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
        debug {
        }
    }

    // 固定 debug 签名：VM 更换会导致默认 ~/.android/debug.keystore 丢失，
    // 曾因此出现 v2.1.0 签名与已安装 v2.0.0 对不上的事故。
    // 这把 keystore 存在 ~/workspace/apk-build/lyrnox-debug.keystore（持久化），
    // 所有构建必须用它签名，保证后续版本都能直接覆盖安装。
    signingConfigs {
        getByName("debug") {
            // 注意：daemon 的 user.home 是 /root，这里必须写绝对路径
            storeFile = file("/home/hatch/workspace/apk-build/lyrnox-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
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
