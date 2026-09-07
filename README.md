# ♻️ Punarvapar — E-Waste Collection & Recycling Platform

Punarvapar is a full-stack e-waste collection and recycling platform that connects scrap collectors with authorized recyclers. It combines AI-assisted image analysis, material-specific recycler matching, lot management, offline-first storage, a web/PWA experience, and a native Android application.

## 🔗 Live Demo

### 🌐 Web Application
https://srsoham.github.io/punarvapar/

### ⚙️ Backend API
https://punarvapar.onrender.com/

### 📚 API Documentation
https://punarvapar.onrender.com/docs

### 📱 Android APK
[Download the latest Android release](https://github.com/SRSoham/punarvapar/releases)

> The Render backend uses a free instance, so the first request after inactivity may take longer while the service wakes up.

---

## ✨ Key Features

- 🤖 **AI E-Waste Scanner** — analyzes uploaded images using the Google Gemini API.
- 🔎 **Material Analysis** — identifies visible devices/components and likely recyclable material categories when sufficient visual information is available.
- 🛡️ **Safe Image Handling** — dark, blank, or low-information images are not blindly classified; users are asked to provide a clearer image or select the material manually.
- ♻️ **Material-Specific Recycler Matching** — PCB is routed to PCB recyclers, plastic to plastic recyclers, metal to metal recyclers, and so on.
- 🏭 **Authorized Recycler Network** — collectors can view verified recycler centres that accept a selected material.
- 📦 **Lot Management** — collectors can create and track e-waste lots.
- 👤 **Collector Dashboard** — shows lots, active collections, earnings, and recycler matches.
- 🏢 **Recycler Dashboard** — shows incoming compatible lots based on the recycler's accepted materials.
- ✅ **Lot Acceptance & Matching** — authorized recyclers can accept compatible lots and become the matched recycler.
- 💰 **Material Price Board** — pricing and estimated lot valuation.
- 📴 **Offline-First Workflow** — IndexedDB stores local data and queues operations for synchronization when connectivity returns.
- 📱 **Android App** — Kotlin + WebView application using the deployed backend.
- 🌐 **PWA Support** — installable web application with service-worker support.
- 🌙 **Dark Mode** — persistent light/dark appearance preference.
- 🌍 **Multilingual Interface** — English, Hindi, and Marathi.
- 🔐 **Role-Based Authentication** — collector, recycler, and admin workflows.
- 🧾 **Recycler Authorization Workflow** — admin verification of recycler/certification information.

---

## 🔄 Main Demo Flow

```text
Collector Login
      ↓
Scan / Upload E-Waste Image
      ↓
AI Material Analysis
      ↓
Select / Confirm Material
      ↓
Find Authorized Recycler
      ↓
Create E-Waste Lot
      ↓
Compatible Recycler Receives Lot
      ↓
Recycler Accepts Lot
      ↓
Collection / Handover
      ↓
Formal Recycling Network
```

---

## ♻️ Material → Recycler Matching

Collectors can select a material manually or use the AI scanner when image analysis is available.

The application then shows only authorized recycler centres whose `materials_accepted` match the selected material.

Example:

```text
PCB
 ↓
Find PCB Recyclers
 ↓
Only authorized PCB-compatible centres
```

```text
Plastic
 ↓
Find Plastic Recyclers
 ↓
Only authorized plastic-compatible centres
```

The same workflow is available for additional material categories such as:

- PCB
- Cable
- Battery
- CRT
- LCD
- Motor
- Plastic
- Metal
- Iron / Steel
- Aluminum
- Copper
- Stainless Steel
- Brass
- Rubber
- Hard Drive
- Power Supply
- Mobile Phone
- Printer
- Router
- Camera
- Speaker
- Game Console
- Solar Panel
- LED Bulb
- Small Appliance
- Keyboard & Mouse
- Electronic Glass
- Cardboard
- Paper
- Textile
- and other supported categories in the catalogue.

---

## 🤖 AI Scanner

The AI scanner sends an uploaded image to the backend for Gemini-based analysis.

The system is designed to distinguish useful e-waste imagery from insufficient visual input. It should not present a laboratory elemental assay or claim exact material composition solely from a photograph.

When Gemini is temporarily unavailable or an image does not contain enough useful visual information, the application falls back to a safe manual-selection experience instead of inventing a confident category.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Offline Storage | IndexedDB, Service Worker |
| Web App | PWA |
| Backend | Python, FastAPI |
| ORM | SQLAlchemy |
| Local Development DB | SQLite |
| Production DB | PostgreSQL |
| Validation / Schemas | Pydantic |
| AI | Google Gemini API |
| Android | Kotlin, Android WebView |
| Web Hosting | GitHub Pages |
| Backend Hosting | Render |

### Architecture

```text
                ┌──────────────────────────┐
                │       Web / PWA           │
                │ HTML5 + CSS3 + JS         │
                │ IndexedDB + ServiceWorker │
                └────────────┬─────────────┘
                             │ HTTPS
                ┌────────────▼─────────────┐
                │       FastAPI API         │
                │ Auth / Lots / Matching    │
                │ AI Image Analysis / Admin │
                └────────────┬─────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        PostgreSQL       Gemini API    Recycler Network

                ┌──────────────────────────┐
                │      Android App         │
                │ Kotlin + WebView         │
                │ Same bundled web UI      │
                └──────────────────────────┘
```

---

## 📁 Project Structure

```text
punarvapar/
├── ewaste-platform/
│   ├── backend/              # FastAPI backend, models, auth, AI, matching, seed
│   └── frontend/             # Web/PWA frontend, dashboard, scanner, i18n
└── punarvapar-android/       # Kotlin + WebView Android application
```

---

## 🚀 Local Development

### 1. Backend

```powershell
cd ewaste-platform/backend

# Windows PowerShell
$env:GEMINI_API_KEY="YOUR_NEW_KEY"

pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. Seed demo data

In a second terminal, while the backend is running:

```powershell
cd ewaste-platform/backend
(Invoke-WebRequest -Uri "http://127.0.0.1:8000/seed" -Method POST -UseBasicParsing).Content
```

### 3. Frontend

In a third terminal:

```powershell
cd ewaste-platform/frontend
python -m http.server 5502
```

Then open:

```text
http://127.0.0.1:5502
```

---

## 📱 Android App

Open `punarvapar-android` in Android Studio.

The Android application uses the bundled frontend and connects to the deployed backend in the released build.

For local testing, ensure the backend URL in the Android configuration points to the reachable API address for your environment.

### Build

```text
Android Studio
→ Build
→ Generate App Bundle(s) / APK(s)
→ Generate APK(s)
```

The generated APK can be published through GitHub Releases.

---

## 🔑 Demo Credentials

### Collector

```text
Phone: 9999999999
Password: demo1234
```

### Admin

```text
Username: admin
Password: admin1234
```

> Demo credentials are for hackathon demonstration only.

---

## 👥 Teammate Access

### Web

Open:

https://srsoham.github.io/punarvapar-hackathon/

No local installation is required.

### Android

Open the GitHub Releases page and download the latest `Punarvapar-v1.0.0.apk` (or the latest release APK) from **Assets**.

https://github.com/SRSoham/punarvapar-hackathon/releases

The released Android app uses the hosted backend, so teammates do not need the developer's PC or the same Wi-Fi network.

---

## 🔐 Security Notes

- Never commit a real `GEMINI_API_KEY` to GitHub.
- Never commit production database credentials.
- Keep secrets in environment variables such as Render Environment Variables.
- Do not bundle Gemini server credentials into frontend JavaScript.
- Demo credentials are not production credentials.

---

## ☁️ Deployment

### Frontend

Hosted on GitHub Pages:

https://srsoham.github.io/punarvapar-hackathon/

### Backend

Hosted on Render:

https://punarvapar.onrender.com/

### Database

Production data is stored in PostgreSQL through the SQLAlchemy ORM.

### AI

Gemini API credentials are supplied to the backend through environment variables.

---

## 🏆 Hackathon Demo Checklist

1. Open the web app or Android app.
2. Login as the Collector.
3. Open **New Lot**.
4. Scan or upload an e-waste image.
5. Review the AI result.
6. Select/confirm the material.
7. Tap **Find [Material] Recyclers**.
8. Show authorized recyclers accepting that material.
9. Create the lot.
10. Login as the Recycler.
11. Show the compatible incoming lot.
12. Accept the lot.
13. Return to the Collector and show the matched recycler.

---

## 🧪 Notes on AI Accuracy

Image classification is an assistive feature, not a physical or laboratory assay. Exact elemental composition cannot be established reliably from a normal photograph alone.

For ambiguous, dark, or low-information images, Punarvapar is designed to avoid unsupported material guesses and allow manual material selection.

---

## 📌 Project Status

Punarvapar is deployed as a working hackathon prototype with:

- ✅ Web/PWA deployment
- ✅ FastAPI backend deployment
- ✅ PostgreSQL production database
- ✅ Gemini AI integration
- ✅ Collector dashboard
- ✅ Recycler dashboard
- ✅ Material-specific recycler matching
- ✅ Lot creation and acceptance
- ✅ Android application and APK release
- ✅ IndexedDB offline-first workflow
- ✅ Multilingual interface
- ✅ Dark mode
- ✅ Admin authorization workflow

---

## 📄 License

MIT License.

---

## 👨‍💻 Repository

https://github.com/SRSoham/punarvapar-hackathon
