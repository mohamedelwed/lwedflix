import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The TV app is a shell around the hosted web app, so it shares the desktop
// app's version (package.json) and its player bridge: electron/preload.js,
// playerProtocol.js and adblock.js are copied in as assets at build time and
// run unchanged inside the WebView (see assets/shim.js). One source of truth
// for both shells.
val repoRoot: File = rootProject.projectDir.parentFile

val appVersion: String = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(File(repoRoot, "package.json").readText())
    ?.groupValues?.get(1)
    ?: error("No version in package.json")

// 1.5.0 → 10500. Each part stays under 100.
val appVersionCode: Int = appVersion.split('.', '-').take(3)
    .map { it.toIntOrNull() ?: 0 }
    .let { (major, minor, patch) -> major * 10000 + minor * 100 + patch }

// Where the hosted app lives: -PlwedflixUrl=… or LWEDFLIX_TV_URL.
val appUrl: String = (findProperty("lwedflixUrl") as String?)
    ?: System.getenv("LWEDFLIX_TV_URL")?.takeIf { it.isNotBlank() }
    ?: "https://lwedflix.vercel.app"

abstract class CopyBridgeTask : DefaultTask() {
    @get:InputFiles
    abstract val sources: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        out.mkdirs()
        sources.forEach { it.copyTo(File(out, it.name), overwrite = true) }
    }
}

val copyBridge = tasks.register<CopyBridgeTask>("copyBridge") {
    sources.from(
        File(repoRoot, "electron/preload.js"),
        File(repoRoot, "electron/playerProtocol.js"),
        File(repoRoot, "electron/adblock.js"),
    )
}

android {
    namespace = "app.lwedflix.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.lwedflix.tv"
        minSdk = 24
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersion
        buildConfigField("String", "APP_URL", "\"${appUrl.trimEnd('/')}\"")
    }

    // A release keystore from CI secrets when there is one (see
    // .github/workflows/android.yml); otherwise the debug key, so a local
    // `gradle assembleRelease` still gives an installable APK. Installs
    // only update in place when every build is signed with the same key.
    val keystore = System.getenv("ANDROID_KEYSTORE_PATH")?.takeIf { File(it).isFile }
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = File(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyBridge, CopyBridgeTask::outputDir)
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
