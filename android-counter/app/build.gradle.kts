plugins { id("com.android.application") }
android {
    namespace = "vn.lotusai.pos.counter"
    compileSdk = 35
    defaultConfig { applicationId = "vn.lotusai.pos.counter"; minSdk = 23; targetSdk = 30; versionCode = 8; versionName = "2.6.0-rc.5.1-counter-p0.6" }
    buildTypes { release { isMinifyEnabled = false } }
    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/posUiAssets"))
}
val syncCounterUi by tasks.registering(Sync::class) {
    from(rootProject.file("../public")) {
        include("counter/index.html", "counter/counter.css", "counter/poc-counter.css", "counter/shift-ui.css", "counter/analytics.css", "counter/devices.js", "counter/shift-ui.js", "counter/analytics.js", "staff/staff.css", "staff/staff.js", "staff/qrcode.js", "staff/scanner.js", "staff/barcode.js", "display/index.html", "display/display.css", "display/display.js", "assets/qrcode.js", "brands/echo-coffee.jpg")
        into("ui")
    }
    into(layout.buildDirectory.dir("generated/posUiAssets"))
}
tasks.named("preBuild") { dependsOn(syncCounterUi) }
