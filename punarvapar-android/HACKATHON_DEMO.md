# Punarvapar Hackathon Demo

## Demo accounts
- Collector: `9999999999` / `demo1234`
- Demo Recycler 1: `+919800000001` / `demo1234`
- Demo Recycler 2: `+919800000002` / `demo1234`
- Demo Recycler 3: `+919800000003` / `demo1234`
- Demo Recycler 4: `+919800000004` / `demo1234`
- Demo Recycler 5: `+919800000005` / `demo1234`
- Demo Recycler 6: `+919800000006` / `demo1234`
- Admin: `admin` / `admin1234`

The seeded recycler names, authorization IDs and price values are explicitly marked as DEMO data for presentation/testing.

## Demo flow
1. Start FastAPI on port 8000.
2. Run POST `/seed` once; it is idempotent and adds missing demo data without deleting existing records.
3. Launch the Android app.
4. Log in as the demo collector.
5. Show Prices -> New Lot -> camera -> weight -> Save Lot.
6. Open Recyclers to show nearby/authorized centres.
7. Log out and use a demo recycler account to show the recycler dashboard.
8. Open the web admin portal separately to demonstrate certificate verification.
