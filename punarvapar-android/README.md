# Punarvapar Android APK Wrapper

This Android Studio project bundles the current Punarvapar offline-first web frontend inside a native Kotlin WebView shell. The existing HTML/CSS/JS IDs and flows are preserved.

## Backend URL

The APK currently points to:

`http://10.230.179.142:8000`

If the PC's LAN IP changes, update `BACKEND_URL` in `app/build.gradle.kts` (both debug and release) and rebuild. The bundled `config.js` exposes that URL to the existing frontend through the `PunarvaparNative` JavaScript bridge.

## Run

1. Open this folder in Android Studio.
2. Let Gradle sync.
3. Keep the Punarvapar FastAPI backend running on the configured LAN address.
4. Connect an Android phone on the same Wi-Fi or use an emulator with an appropriate reachable backend address.
5. Press Run.

## Build APK

Android Studio: **Build > Generate App Bundles or APKs > Generate APKs**.

Debug APK output is normally under:

`app/build/outputs/apk/debug/`


## Final demo behavior
- New Lot category selection immediately shows the authorized recyclers accepting that category.
- Each lot can be matched to a selected authorized recycler from the lot detail screen.
- Authorized recyclers see compatible incoming lots in their dashboard.
- Green environmental theme and refreshed recycling launcher icon are included.
