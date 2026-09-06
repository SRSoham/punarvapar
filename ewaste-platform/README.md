# Punarvapar — E-Waste Formal Recycling Bridge (Prototype)

Working prototype for the SIH problem statement: a vernacular, offline-tolerant
platform connecting informal e-waste collectors to authorized recyclers.

## What's built

**Backend** (`/backend`) — FastAPI + SQLite, matches your planned tech stack
(Python/FastAPI/SQLAlchemy/JWT-ready). Implements every dataset from the
problem statement (material, price, recycler, transaction, traceability,
collector) and the endpoints the app needs:

- `POST /seed` — loads demo recyclers + price history (run once)
- `GET /price-board` — cache this on-device for offline valuation
- `POST /valuation` — instant value estimate for a lot
- `GET /recyclers` — nearby authorized recyclers, ranked by distance
- `POST /lots`, `GET /lots/{id}`, `POST /lots/{id}/match`
- `POST /handover` — generates a verifiable handover record (photo ref, GPS,
  timestamp, unique ref) + flags abnormal transaction values automatically
- `GET /collectors/{id}/ledger` — earnings ledger
- `POST /sync/push` / `GET /sync/pull` — the offline-sync contract

Run it:
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
curl -X POST http://localhost:8000/seed   # load demo data
```
Docs at `http://localhost:8000/docs` (Swagger, auto-generated).

**Frontend** (`/frontend`) — an installable offline-first PWA for the collector,
in Marathi / Hindi / English. This is a *working, testable* substitute for the
planned Flutter app (Flutter can't be compiled in this sandbox) — same
architecture (local-first storage + background sync), same API calls your
teammate would wire up with Retrofit/http in Flutter. It runs today on any
Android phone's browser and can be "Add to Home Screen" installed.

- IndexedDB stores lots/photos/price-cache/recycler-cache locally
- Every action (photograph → categorize → weigh → get estimate → save lot →
  match recycler → handover) works with **zero connectivity**
- A queued sync engine pushes pending lots/handovers the moment the device
  reconnects (see the "Sync now" pill in the status bar)
- Big icon tiles, minimal text, audio playback (🔊) on every price and safety
  tip for low-literacy use
- Service worker caches the app shell so it loads offline after first visit

To run:
1. Edit `frontend/app.js` — set `DEFAULT_API_BASE` to wherever your backend is
   hosted (or set `localStorage.setItem('api_base', 'https://your-api')` in
   the browser console once).
2. Serve the folder over HTTP (service workers need http/https, not `file://`):
   ```bash
   cd frontend
   python3 -m http.server 8080
   ```
3. Open `http://localhost:8080` on a phone or in Chrome DevTools' mobile view.

## What's stubbed / next steps for the full submission

- **AI/ML classification**: not wired in this prototype (valuation currently
  uses category selected by the collector + cached price data, which is
  honest and safer for a hackathon demo than a fake model). Your plan
  (YOLO11/MobileNetV3 → TFLite, 5–6 categories, Colab-trained) is the right
  scope — swap the manual category-tile tap for a photo-classify step once
  you have a trained `.tflite` model; the `image_ref` field already carries
  the photo through to the dataset for later training.
- **Real Flutter app**: port `app.js`'s IndexedDB logic to Hive/Room and the
  `fetch()` calls to Retrofit/http.dio — the API contract stays identical.
- **Authentication**: The PWA now has a role-based login/registration gate for
  **Scrap Collectors** and **Authorized Recyclers**. Registration collects phone,
  password, operating/facility details and a certification/authorization
  document (PDF/JPG/PNG/WEBP). New registrations are marked `pending` until
  verification; seeded demo accounts are already approved. The frontend stores
  the session token in `localStorage` and sends it as a Bearer token. Recycler
  accounts see a dedicated dashboard, while collectors enter the existing
  offline-first workflow. For production, replace the in-memory session store
  with JWT/Redis and add an authenticated government/admin approval workflow.
- **Field research**: the problem statement requires interviews with ≥2 real
  scrap collectors — that's on you, but the price-board schema
  (category/sub-category/location/date/price/range) is built to be filled
  from that fieldwork directly.
- **Unit economics**: not computed here — plug real collector earnings data
  from your field interviews into `/collectors/{id}/ledger` vs. their
  informal-market baseline.

## Anomaly detection (already working)

`POST /handover` flags a transaction automatically if its implied ₹/kg is
>3x or <15% of the category's historical average — a first pass at "abnormal
transaction value" detection the problem statement asks for, before you need
any ML.


## Admin certification verification

The Punarvapar prototype now includes a backend-protected admin verification portal. Regular collector/recycler accounts do not see an admin navigation item.

Open `http://localhost:8080/#admin` to reach the administrator login. Default prototype credentials:
- Username: `admin`
- Password: `admin1234`

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables before starting FastAPI to change them. The admin can view uploaded certificates and approve/reject collector and authorized-recycler applications. Approval is required before login is allowed.
