# Punarvapar Final Complete Project

This archive intentionally contains the complete hackathon project in one ZIP.

## Folders
- `ewaste-platform/backend` — FastAPI backend, database models, authentication, demo seed data, AI image analysis, material/recycler matching.
- `ewaste-platform/frontend` — Web/PWA frontend with full material catalogue, collector dashboard, recycler dashboard, AI scanner UI, material-specific recycler finder.
- `punarvapar-android` — Android Studio Kotlin/WebView wrapper that bundles the same frontend assets and uses the configured FastAPI backend URL.

## Local development
Backend:
`cd ewaste-platform/backend`
`$env:GEMINI_API_KEY="YOUR_NEW_KEY"`
`uvicorn main:app --host 0.0.0.0 --port 8000`

Seed (new terminal):
`cd ewaste-platform/backend`
`(Invoke-WebRequest -Uri "http://127.0.0.1:8000/seed" -Method POST -UseBasicParsing).Content`

Frontend (new terminal):
`cd ewaste-platform/frontend`
`python -m http.server 5502`

Open `http://127.0.0.1:5502`.

## Android
Open `punarvapar-android` in Android Studio. The debug/release backend URL is configured in `app/build.gradle.kts`.

Do not put a real Gemini key in source control or inside the APK.
