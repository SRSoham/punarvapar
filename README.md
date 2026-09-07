# ♻️ Punarvapar — E-Waste Collection & Recycling Platform

Punarvapar ("re-utilization" in Sanskrit) is a full-stack platform that connects people who want to responsibly dispose of e-waste with collectors and recyclers. It includes an AI-powered scanner that identifies e-waste material from a photo, matches it to the right recycler, and ships as both a web/PWA and a native Android app.

> Originally built as a hackathon project — this repo bundles the complete backend, frontend, and Android wrapper.

## 🔗 Live Demo

- **Web app:** [srsoham.github.io/punarvapar](https://srsoham.github.io/punarvapar/)
- **Backend API:** [punarvapar.onrender.com](https://punarvapar.onrender.com)
- **Android APK:** [Download latest release](https://github.com/SRSoham/punarvapar/releases/latest)

> ⚠️ The backend is hosted on Render's free tier — it spins down when idle, so the first request after inactivity can take 30–60 seconds to respond.

## ✨ Features

- **AI e-waste scanner** — snap a photo and get the material/category identified automatically (Gemini API).
- **Material catalogue** — browse accepted e-waste categories and materials.
- **Collector dashboard** — track pickups and submissions.
- **Recycler dashboard** — view and manage incoming material matches.
- **Recycler finder** — matches specific materials to the nearest/most relevant recycler.
- **Cross-platform** — web/PWA frontend plus a native Android wrapper around the same UI.

## 🗂️ Project structure

```
punarvapar/
├── ewaste-platform/
│   ├── backend/     # FastAPI backend — models, auth, seed data, AI image analysis, matching logic
│   └── frontend/    # Web/PWA frontend — catalogue, dashboards, AI scanner UI
└── punarvapar-android/   # Kotlin + WebView Android wrapper around the frontend
```

## 🛠️ Tech stack

| Layer     | Tech |
|-----------|------|
| Backend   | Python, FastAPI, Gemini API (AI image analysis) |
| Frontend  | HTML/CSS/JS (PWA) |
| Mobile    | Kotlin, Android WebView |

## 🚀 Getting started

### Prerequisites

- Python 3.10+
- A [Gemini API key](https://ai.google.dev/) (for the AI scanner)
- Android Studio (only if building the Android app)

### 1. Backend

```bash
cd ewaste-platform/backend

# set your Gemini API key
# Windows (PowerShell):
$env:GEMINI_API_KEY="YOUR_NEW_KEY"
# macOS/Linux:
export GEMINI_API_KEY="YOUR_NEW_KEY"

pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. Seed demo data

In a new terminal, with the backend running:

```bash
curl -X POST http://127.0.0.1:8000/seed
```

(PowerShell equivalent: `(Invoke-WebRequest -Uri "http://127.0.0.1:8000/seed" -Method POST -UseBasicParsing).Content`)

### 3. Frontend

In a new terminal:

```bash
cd ewaste-platform/frontend
python -m http.server 5502
```

Open **http://127.0.0.1:5502** in your browser.

### 4. Android app (optional)

Open `punarvapar-android` in Android Studio. The debug/release backend URL is configured in `app/build.gradle.kts` — point it at your running backend.

## 🔐 Security notes

- **Never commit a real `GEMINI_API_KEY`** to source control or bundle it inside the built APK.
- Use environment variables or a local `.env` file (excluded via `.gitignore`) for secrets.

## 🗺️ Roadmap

- [ ] Add automated tests for the matching logic
- [ ] Deploy a hosted demo (backend + frontend)
- [ ] Publish a signed Android release build
- [ ] Document the API endpoints (OpenAPI/Swagger is available at `/docs` when running locally)

## 🤝 Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

## 📄 License

_Add a license (e.g. MIT) so others know how they can use this project._

## 👤 Author

Built by [Soham (SRSoham)](https://github.com/SRSoham).
