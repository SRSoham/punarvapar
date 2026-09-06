"""
E-Waste Formal Recycling Bridge — Backend API
Run: uvicorn main:app --reload --host 0.0.0.0 --port 8000
Docs: http://localhost:8000/docs
"""
import math
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta
from typing import List, Optional
import json


from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func

import models, schemas

try:
    from google import genai
    from google.genai import types as genai_types
except Exception:
    genai = None
    genai_types = None
from database import engine, get_db, SessionLocal

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="E-Waste Formal Recycling Bridge API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
AUTH_TOKENS = {}  # prototype session store; replace with JWT/Redis for production

# Optional multimodal AI configuration. Keep the API key on the backend only.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()

AI_CATEGORY_MAP = {
    "pcb": "PCB", "circuit board": "PCB", "motherboard": "PCB", "logic board": "PCB",
    "cable": "cable", "wire": "cable", "wiring": "cable",
    "battery": "battery", "battery pack": "battery",
    "crt": "CRT", "crt display": "CRT", "television": "CRT",
    "lcd": "LCD", "display": "LCD", "monitor": "LCD", "screen": "LCD",
    "motor": "motor", "fan motor": "motor",
    "plastic": "mixed_plastic", "plastic housing": "mixed_plastic",
    "metal": "metal", "aluminum": "metal", "steel": "metal", "metal frame": "metal",
    "hard drive": "hard_drive", "hard disk": "hard_drive", "hdd": "hard_drive", "ssd": "hard_drive",
    "power supply": "power_supply", "psu": "power_supply", "adapter": "power_supply", "charger": "power_supply",
    "mobile phone": "mobile", "smartphone": "mobile", "phone": "mobile",
    "printer": "printer", "scanner": "printer",
    "keyboard": "keyboard_mouse", "mouse": "keyboard_mouse", "keyboard and mouse": "keyboard_mouse",
    "glass": "glass", "screen glass": "glass",
    "iron": "ferrous_metal", "steel": "ferrous_metal", "stainless steel": "stainless_steel",
    "aluminum": "aluminum", "aluminium": "aluminum", "copper": "copper",
    "brass": "brass", "rubber": "rubber",
    "router": "router", "wifi router": "router", "camera": "camera",
    "speaker": "speaker", "game console": "game_console", "gaming console": "game_console",
    "solar panel": "solar_panel", "photovoltaic panel": "solar_panel",
    "led bulb": "led_bulb", "bulb": "led_bulb", "small appliance": "small_appliance",
    "cardboard": "cardboard", "paper": "paper", "textile": "textile", "cloth": "textile",
}

def _normalize_ai_category(value: str) -> str:
    raw = (value or "").strip().lower()
    if raw in AI_CATEGORY_MAP:
        return AI_CATEGORY_MAP[raw]
    for key, category in AI_CATEGORY_MAP.items():
        if key in raw:
            return category
    return "PCB"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"pbkdf2_sha256$120000${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, rounds, salt_hex, digest_hex = encoded.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(candidate.hex(), digest_hex)
    except Exception:
        return False


def create_token(role: str, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    AUTH_TOKENS[token] = {"role": role, "user_id": user_id}
    return token


def current_auth(authorization: Optional[str] = None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    session = AUTH_TOKENS.get(authorization[7:])
    if not session:
        raise HTTPException(401, "Invalid or expired token")
    return session


ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin1234")


def admin_auth(authorization: Optional[str] = None):
    session = current_auth(authorization)
    if session["role"] != "admin":
        raise HTTPException(403, "Admin access required")
    return session


@app.post("/auth/admin/login")
def admin_login(payload: schemas.AdminLoginRequest):
    if not hmac.compare_digest(payload.username.strip(), ADMIN_USERNAME) or not hmac.compare_digest(payload.password, ADMIN_PASSWORD):
        raise HTTPException(401, "Invalid admin username or password")
    token = create_token("admin", "ADMIN")
    return {"token": token, "role": "admin", "user": {"id": "ADMIN", "name": "System Administrator"}}


@app.get("/admin/applications")
def admin_applications(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    admin_auth(authorization)
    collectors = db.query(models.Collector).order_by(models.Collector.created_at.desc()).all()
    recyclers = db.query(models.Recycler).order_by(models.Recycler.name.asc()).all()
    return {
        "collectors": [{
            "id": c.id, "name": c.name, "phone": c.phone,
            "certification_number": c.certification_number,
            "operating_location": c.operating_location,
            "certification_file": c.certification_file,
            "verification_status": c.verification_status or "approved",
            "created_at": c.created_at.isoformat() if c.created_at else None,
        } for c in collectors if c.certification_file],
        "recyclers": [{
            "id": r.id, "name": r.name, "phone": r.phone,
            "facility_location": r.facility_location,
            "authorization_id": r.authorization_id,
            "contact": r.contact,
            "certification_file": r.certification_file,
            "authorization_status": r.authorization_status or "authorized",
            "verification_status": r.verification_status or "approved",
        } for r in recyclers if r.certification_file],
    }


@app.get("/admin/certificates/{role}/{user_id}")
def admin_certificate(role: str, user_id: str, authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    from fastapi.responses import FileResponse
    admin_auth(authorization)
    role = role.lower().strip()
    if role == "collector":
        user = db.query(models.Collector).get(user_id)
    elif role == "recycler":
        user = db.query(models.Recycler).get(user_id)
    else:
        raise HTTPException(400, "Role must be collector or recycler")
    if not user or not user.certification_file:
        raise HTTPException(404, "Certification document not found")
    path = os.path.join(UPLOAD_DIR, user.certification_file)
    if not os.path.isfile(path):
        raise HTTPException(404, "Certification document file not found")
    return FileResponse(path, filename=user.certification_file)


@app.post("/admin/applications/{role}/{user_id}/{decision}")
def admin_decide_application(role: str, user_id: str, decision: str, authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    admin_auth(authorization)
    role = role.lower().strip()
    decision = decision.lower().strip()
    if decision not in {"approved", "rejected"}:
        raise HTTPException(400, "Decision must be approved or rejected")
    if role == "collector":
        user = db.query(models.Collector).get(user_id)
        if not user:
            raise HTTPException(404, "Collector application not found")
        user.verification_status = decision
    elif role == "recycler":
        user = db.query(models.Recycler).get(user_id)
        if not user:
            raise HTTPException(404, "Recycler application not found")
        user.verification_status = decision
        user.authorization_status = "authorized" if decision == "approved" else "revoked"
    else:
        raise HTTPException(400, "Role must be collector or recycler")
    db.commit()
    return {"status": decision, "role": role, "user_id": user_id}


def save_certificate(file: UploadFile, prefix: str) -> str:
    if not file or not file.filename:
        raise HTTPException(400, "Certification document is required")
    ext = os.path.splitext(file.filename)[1].lower()
    allowed = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}
    if ext not in allowed:
        raise HTTPException(400, "Certificate must be PDF, JPG, PNG or WEBP")
    safe_name = f"{prefix}-{secrets.token_hex(8)}{ext}"
    path = os.path.join(UPLOAD_DIR, safe_name)
    with open(path, "wb") as out:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    return safe_name


@app.post("/auth/register/collector")
async def register_collector(
    name: str = Form(...),
    phone: str = Form(...),
    password: str = Form(...),
    certification_number: str = Form(...),
    operating_location: str = Form(...),
    preferred_language: str = Form("mr"),
    certification: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if db.query(models.Collector).filter(models.Collector.phone == phone).first():
        raise HTTPException(409, "A collector with this phone number already exists")
    cert_name = save_certificate(certification, "collector")
    c = models.Collector(
        name=name.strip(), phone=phone.strip(), password_hash=hash_password(password),
        certification_number=certification_number.strip(), certification_file=cert_name,
        operating_location=operating_location.strip(), preferred_language=preferred_language,
        verification_status="pending"
    )
    db.add(c); db.commit(); db.refresh(c)
    return {"status": "pending", "message": "Registration submitted for verification", "user_id": c.id}


@app.post("/auth/register/recycler")
async def register_recycler(
    name: str = Form(...),
    phone: str = Form(...),
    password: str = Form(...),
    facility_location: str = Form(...),
    authorization_id: str = Form(...),
    contact: str = Form(...),
    lat: float = Form(0),
    lng: float = Form(0),
    certification: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if db.query(models.Recycler).filter(models.Recycler.phone == phone).first():
        raise HTTPException(409, "A recycler with this phone number already exists")
    cert_name = save_certificate(certification, "recycler")
    r = models.Recycler(
        name=name.strip(), phone=phone.strip(), password_hash=hash_password(password),
        facility_location=facility_location.strip(), authorization_id=authorization_id.strip(),
        contact=contact.strip(), lat=lat, lng=lng, certification_file=cert_name,
        authorization_status="pending", verification_status="pending"
    )
    db.add(r); db.commit(); db.refresh(r)
    return {"status": "pending", "message": "Registration submitted for government verification", "user_id": r.id}


@app.post("/auth/login")
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    role = payload.role.lower().strip()
    if role == "collector":
        user = db.query(models.Collector).filter(models.Collector.phone == payload.phone.strip()).first()
        if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
            raise HTTPException(401, "Invalid phone number or password")
        status = user.verification_status or "approved"
        if status != "approved":
            raise HTTPException(403, f"Account verification status: {status}")
        token = create_token("collector", user.id)
        return {"token": token, "role": "collector",
                "user": {"id": user.id, "name": user.name, "phone": user.phone,
                         "verification_status": status}}
    if role == "recycler":
        user = db.query(models.Recycler).filter(models.Recycler.phone == payload.phone.strip()).first()
        if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
            raise HTTPException(401, "Invalid phone number or password")
        status = user.verification_status or user.authorization_status or "approved"
        if status != "approved":
            raise HTTPException(403, f"Account verification status: {status}")
        token = create_token("recycler", user.id)
        return {"token": token, "role": "recycler",
                "user": {"id": user.id, "name": user.name, "phone": user.phone,
                         "authorization_id": user.authorization_id,
                         "authorization_status": user.authorization_status}}
    raise HTTPException(400, "Role must be collector or recycler")


@app.get("/auth/me")
def auth_me(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    # Supports Authorization header through FastAPI's raw header injection below only if provided by client.
    session = current_auth(authorization)
    if session["role"] == "collector":
        u = db.query(models.Collector).get(session["user_id"])
        return {"role": "collector", "user": {"id": u.id, "name": u.name, "phone": u.phone}}
    u = db.query(models.Recycler).get(session["user_id"])
    return {"role": "recycler", "user": {"id": u.id, "name": u.name, "phone": u.phone,
                                          "authorization_id": u.authorization_id}}


@app.get("/collector/dashboard")
def collector_dashboard(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    session = current_auth(authorization)
    if session["role"] != "collector":
        raise HTTPException(403, "Collector access required")
    c = db.query(models.Collector).get(session["user_id"])
    if not c:
        raise HTTPException(404, "Collector not found")
    lots = (db.query(models.MaterialLot)
            .filter(models.MaterialLot.collector_id == c.id)
            .order_by(models.MaterialLot.collected_at.desc()).limit(10).all())
    total_lots = db.query(models.MaterialLot).filter(models.MaterialLot.collector_id == c.id).count()
    completed = db.query(models.MaterialLot).filter(models.MaterialLot.collector_id == c.id, models.MaterialLot.status.in_(["handed_over", "confirmed", "paid"])).count()
    pending = db.query(models.MaterialLot).filter(models.MaterialLot.collector_id == c.id, models.MaterialLot.status.in_(["draft", "quoted", "available", "matched", "pending_sync"])).count()
    earned = db.query(func.coalesce(func.sum(models.MaterialLot.final_sale_value), 0)).filter(models.MaterialLot.collector_id == c.id, models.MaterialLot.payment_status == "paid").scalar() or 0
    categories = {}
    for l in lots:
        categories[l.material_category] = categories.get(l.material_category, 0) + 1
    latest_category = lots[0].material_category if lots else None
    recommended = []
    if latest_category:
        recommended = list_recyclers(material_category=latest_category, lat=c.lat, lng=c.lng, db=db)[:4]
    return {
        "collector": {"id": c.id, "name": c.name, "preferred_language": c.preferred_language, "operating_location": c.operating_location, "verification_status": c.verification_status},
        "stats": {"total_lots": total_lots, "completed_lots": completed, "active_lots": pending, "paid_earnings": round(float(earned), 2)},
        "latest_category": latest_category,
        "category_counts": categories,
        "recommended_recyclers": [r.model_dump() if hasattr(r, "model_dump") else r.dict() for r in recommended],
        "recent_lots": [{
            "id": l.id, "category": l.material_category, "weight": l.approx_weight_kg,
            "status": l.status, "value": l.final_sale_value or l.quoted_price or l.estimated_value,
            "matched_recycler_id": l.matched_recycler_id,
            "matched_recycler_name": (db.query(models.Recycler).get(l.matched_recycler_id).name if l.matched_recycler_id and db.query(models.Recycler).get(l.matched_recycler_id) else None),
            "date": l.collected_at.isoformat()
        } for l in lots],
        "material_network": {
            cat: [schemas.RecyclerOut(
                id=r.id, name=r.name, facility_location=r.facility_location, lat=r.lat, lng=r.lng,
                materials_accepted=r.materials_accepted or "", authorization_status=r.authorization_status or "authorized",
                contact=r.contact or "", pickup_available=r.pickup_available,
                distance_km=round(haversine_km(c.lat, c.lng, r.lat, r.lng), 1) if c.lat is not None and c.lng is not None else None
            ).model_dump() for r in list_recyclers(material_category=cat, lat=c.lat, lng=c.lng, db=db)[:5]]
            for cat in [x for x in ["PCB","cable","battery","CRT","LCD","motor","mixed_plastic","metal","hard_drive","power_supply","mobile","printer","keyboard_mouse","glass"]]
        }
    }


@app.get("/recycler/dashboard")
def recycler_dashboard(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    session = current_auth(authorization)
    if session["role"] != "recycler":
        raise HTTPException(403, "Recycler access required")
    r = db.query(models.Recycler).get(session["user_id"])
    # Lots already matched to this recycler, plus all currently available lots
    # whose category is accepted by this recycler. This makes new compatible
    # lots immediately visible to specialized authorized recyclers.
    matched = db.query(models.MaterialLot).filter(models.MaterialLot.matched_recycler_id == r.id)
    incoming = []
    accepted = [x.strip() for x in (r.materials_accepted or "").split(",") if x.strip()]
    if accepted:
        incoming = (db.query(models.MaterialLot)
                   .filter(models.MaterialLot.material_category.in_(accepted),
                           models.MaterialLot.status.in_(["quoted", "available", "matched"]),
                           ((models.MaterialLot.matched_recycler_id == None) | (models.MaterialLot.matched_recycler_id == r.id)))
                   .order_by(models.MaterialLot.collected_at.desc()).limit(30).all())
    by_id = {}
    for l in list(matched.order_by(models.MaterialLot.collected_at.desc()).limit(20).all()) + incoming:
        by_id[l.id] = l
    lots = list(by_id.values())
    lots.sort(key=lambda x: x.collected_at or datetime.min, reverse=True)
    return {
        "recycler": {"id": r.id, "name": r.name, "facility_location": r.facility_location,
                     "authorization_id": r.authorization_id, "authorization_status": r.authorization_status,
                     "materials_accepted": r.materials_accepted, "pickup_available": r.pickup_available},
        "stats": {"matched_lots": matched.count(),
                  "incoming_lots": len(incoming),
                  "handed_over": db.query(models.MaterialLot).filter(models.MaterialLot.matched_recycler_id == r.id,
                                                                    models.MaterialLot.status.in_(["handed_over", "confirmed", "paid"])).count()},
        "lots": [{
            "id": l.id, "category": l.material_category, "weight": l.approx_weight_kg,
            "status": l.status, "value": l.final_sale_value or l.quoted_price or l.estimated_value,
            "date": l.collected_at.isoformat(),
            "is_incoming": l.matched_recycler_id != r.id,
            "collector_name": (db.query(models.Collector).get(l.collector_id).name if l.collector_id and db.query(models.Collector).get(l.collector_id) else "Collector"),
            "collection_location": l.collection_location_text or "Location not shared",
            "collector_phone": (db.query(models.Collector).get(l.collector_id).phone if l.collector_id and db.query(models.Collector).get(l.collector_id) else None)
        } for l in lots]
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def get_reference_price(db: Session, category: str, location: Optional[str]):
    """Latest known price for a category (location-aware, falls back to any location)."""
    q = db.query(models.PriceEntry).filter(models.PriceEntry.material_category == category)
    if location:
        loc_q = q.filter(models.PriceEntry.location == location).order_by(models.PriceEntry.date.desc())
        entry = loc_q.first()
        if entry:
            return entry
    return q.order_by(models.PriceEntry.date.desc()).first()


def price_trend(db: Session, category: str, location: Optional[str]) -> str:
    q = db.query(models.PriceEntry).filter(models.PriceEntry.material_category == category)
    if location:
        q = q.filter(models.PriceEntry.location == location)
    entries = q.order_by(models.PriceEntry.date.desc()).limit(5).all()
    if len(entries) < 2:
        return "stable"
    if entries[0].buying_price > entries[-1].buying_price:
        return "rising"
    if entries[0].buying_price < entries[-1].buying_price:
        return "falling"
    return "stable"


def detect_anomaly(db: Session, category: str, value: float, weight: float) -> (bool, Optional[str]):
    """Flag lots whose implied unit price is wildly off historical average."""
    avg = (
        db.query(func.avg(models.PriceEntry.buying_price))
        .filter(models.PriceEntry.material_category == category)
        .scalar()
    )
    if not avg or weight <= 0:
        return False, None
    implied_unit = value / weight
    if implied_unit > avg * 3:
        return True, f"Value implies unit price {implied_unit:.1f}/kg, >3x category avg {avg:.1f}/kg"
    if implied_unit < avg * 0.15:
        return True, f"Value implies unit price {implied_unit:.1f}/kg, suspiciously below avg {avg:.1f}/kg"
    return False, None



# ---------------------------------------------------------------------------
# AI e-waste image scanner
# ---------------------------------------------------------------------------

@app.post("/ai/analyze-image")
async def analyze_ewaste_image(
    image: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
    hint_category: Optional[str] = Form(None),
):
    """Analyze an uploaded e-waste photo.

    Primary path uses Gemini multimodal analysis. If Gemini is temporarily unavailable,
    the endpoint retries with a lighter model and finally returns a clearly-labelled
    local fallback so a live hackathon demo does not get stuck.
    """
    session = current_auth(authorization)
    if session.get("role") != "collector":
        raise HTTPException(403, "AI scanner is available to collectors")
    if not image.filename:
        raise HTTPException(400, "Image is required")
    if not (image.content_type or "").startswith("image/"):
        raise HTTPException(400, "Please upload an image file")
    raw = await image.read()
    if not raw:
        raise HTTPException(400, "The uploaded image is empty")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image is too large. Please use an image under 10 MB")

    if not GEMINI_API_KEY or genai is None or genai_types is None:
        return _ai_fallback_result(hint_category, "Gemini is not configured on the backend.")

    class AIComponent(schemas.BaseModel):
        name: str
        confidence: float
        materials: List[str]
        hazardous: bool
        note: str

    class AIResult(schemas.BaseModel):
        device: str
        confidence: float
        summary: str
        recommended_category: Optional[str]
        is_e_waste: bool
        components: List[AIComponent]
        safety_notes: List[str]

    prompt = """
You are the Punarvapar e-waste image analyst.
Analyze the uploaded image of an item that may be electronic waste.

Return ONLY JSON matching the provided schema.

Rules:
1. First decide whether the photographed object is electronic/electrical waste. Set is_e_waste=false for ordinary non-electronic objects such as spoons, plates, bottles, furniture, clothing, food, stationery, tools without electronics, etc.
2. If is_e_waste=false, set recommended_category=null, set device to a concise description such as "Non-electronic item", explain that the item is not e-waste, and do not force it into PCB or another e-waste category.
3. If is_e_waste=true, identify the most likely visible device first (examples: laptop, desktop, phone, TV, monitor, printer, router, camera, speaker, game console, solar panel, bulb, small appliance, mixed electronics).
4. List only components that are visible or strongly inferable from the device construction. Do not claim to literally see components that are fully hidden.
5. For each component, provide typical/likely material associations relevant to recycling (examples: copper, aluminum, steel, stainless steel, plastic, glass, silicon, gold-plated contacts, lead-containing CRT glass, lithium-ion battery materials).
6. These are material associations, NOT an exact chemical/elemental assay. Never state that an element is scientifically confirmed from the photo alone.
7. Flag a component hazardous when mishandling it could create meaningful safety/environmental risk (especially batteries, CRT glass, lamps, damaged capacitors/components).
8. recommended_category MUST be one of: PCB, cable, battery, CRT, LCD, motor, mixed_plastic, metal, ferrous_metal, aluminum, copper, stainless_steel, brass, rubber, hard_drive, power_supply, mobile, printer, router, camera, speaker, game_console, solar_panel, led_bulb, small_appliance, keyboard_mouse, glass, cardboard, paper, textile, or null when not e-waste.
9. confidence values must be between 0 and 1.
10. Never use PCB as a generic fallback for an ordinary object. Only recommend PCB when a circuit board/electronic assembly is actually visible or strongly justified.
"""

    def _call_model(model_name: str):
        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model=model_name,
            contents=[
                genai_types.Part.from_bytes(data=raw, mime_type=image.content_type),
                prompt,
            ],
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AIResult.model_json_schema(),
                thinking_config=genai_types.ThinkingConfig(thinking_level="low"),
            ),
        )
        text = (response.text or "").strip()
        if not text:
            raise RuntimeError(f"{model_name} returned an empty response")
        result = AIResult.model_validate_json(text)
        payload = result.model_dump()
        rec = payload.get("recommended_category")
        payload["recommended_category"] = _normalize_ai_category(rec) if payload.get("is_e_waste") and rec else None
        payload["ai_model"] = model_name
        payload["analysis_mode"] = "ai"
        payload["disclaimer"] = "AI provides visual estimates and typical material associations; it does not replace laboratory composition testing."
        return payload

    # Try the high-quality model once, then the lower-latency model once.
    # This specifically protects the hackathon demo from transient 503/UNAVAILABLE spikes.
    models_to_try = [GEMINI_MODEL]
    if "gemini-3.5-flash-lite" not in models_to_try:
        models_to_try.append("gemini-3.5-flash-lite")
    last_error = None
    for model_name in models_to_try:
        try:
            return _call_model(model_name)
        except Exception as exc:
            last_error = exc
            msg = str(exc).lower()
            # Retry only for likely transient/rate/demand errors; other errors can move to fallback.
            transient = any(x in msg for x in ("503", "unavailable", "429", "resource_exhausted", "deadline", "timeout", "temporar"))
            if transient:
                continue
            break

    return _ai_fallback_result(hint_category, str(last_error)[:220] if last_error else "Gemini did not return a usable result.")


def _ai_fallback_result(hint_category: Optional[str], reason: str = ""):
    category = _normalize_ai_category(hint_category) if hint_category else None
    profiles = {
        "PCB": ("Electronic circuit board", ["Copper", "Gold-plated contacts", "Silicon", "Tin"], False),
        "battery": ("Battery / battery pack", ["Lithium-ion battery materials", "Copper", "Aluminum", "Plastic"], True),
        "cable": ("Cable / wiring", ["Copper", "PVC / plastic insulation"], False),
        "mixed_plastic": ("Plastic electronic enclosure", ["Engineering plastics"], False),
        "metal": ("Metal electronic component / scrap", ["Steel", "Aluminum", "Copper"], False),
        "ferrous_metal": ("Iron / steel item", ["Iron", "Steel"], False),
        "aluminum": ("Aluminum item", ["Aluminum"], False),
        "copper": ("Copper item / wiring", ["Copper"], False),
        "stainless_steel": ("Stainless steel item", ["Stainless steel"], False),
    }
    if category in profiles:
        device, mats, hazardous = profiles[category]
        is_ewaste = category in {"PCB", "battery", "cable", "mixed_plastic", "metal"}
        return {
            "device": device, "confidence": 0.82,
            "summary": "Gemini is temporarily unavailable. Smart Fallback is using the collector-selected category.",
            "is_e_waste": is_ewaste, "recommended_category": category,
            "components": [{"name": device, "confidence": 0.82, "materials": mats, "hazardous": hazardous, "note": "Conservative typical material association; not image-confirmed composition."}],
            "safety_notes": ["Follow safe handling guidance for batteries and hazardous e-waste."] if hazardous else [],
            "ai_model": "punarvapar-smart-fallback", "analysis_mode": "fallback",
            "fallback_reason": reason or "Temporary AI service unavailability.",
            "disclaimer": "Fallback mode uses the collector-selected category and does not claim image-confirmed elemental analysis.",
        }
    return {
        "device": "Unable to classify safely", "confidence": 0.0,
        "summary": "Gemini is temporarily unavailable. Punarvapar will not guess a material category without reliable visual analysis. Please select the correct material manually.",
        "is_e_waste": False, "recommended_category": None, "components": [], "safety_notes": [],
        "ai_model": "punarvapar-smart-fallback", "analysis_mode": "fallback",
        "fallback_reason": reason or "Temporary AI service unavailability.",
        "disclaimer": "Fallback mode does not perform image classification or laboratory composition analysis.",
    }


# ---------------------------------------------------------------------------
# Price board / valuation (this is what the app caches for offline use)
# ---------------------------------------------------------------------------

@app.get("/price-board")
def price_board(location: Optional[str] = None, db: Session = Depends(get_db)):
    """Returns latest price per category — cache this blob on-device for offline valuation."""
    categories = [r[0] for r in db.query(models.PriceEntry.material_category).distinct()]
    board = []
    for cat in categories:
        entry = get_reference_price(db, cat, location)
        if not entry:
            continue
        board.append({
            "material_category": cat,
            "location": entry.location,
            "buying_price": entry.buying_price,
            "unit": entry.unit,
            "market_range_low": entry.market_range_low,
            "market_range_high": entry.market_range_high,
            "trend": price_trend(db, cat, location),
            "as_of": entry.date.isoformat(),
        })
    return {"generated_at": datetime.utcnow().isoformat(), "items": board}


@app.post("/valuation", response_model=schemas.ValuationResponse)
def valuation(req: schemas.ValuationRequest, db: Session = Depends(get_db)):
    entry = get_reference_price(db, req.material_category, req.location)
    if not entry:
        raise HTTPException(404, f"No price data for category '{req.material_category}' yet")
    est_value = round(entry.buying_price * req.approx_weight_kg, 2)
    return schemas.ValuationResponse(
        material_category=req.material_category,
        approx_weight_kg=req.approx_weight_kg,
        estimated_unit_price=entry.buying_price,
        estimated_value=est_value,
        market_range_low=entry.market_range_low,
        market_range_high=entry.market_range_high,
        price_trend=price_trend(db, req.material_category, req.location),
        source="live",
    )


# ---------------------------------------------------------------------------
# Recyclers
# ---------------------------------------------------------------------------

@app.get("/recyclers", response_model=List[schemas.RecyclerOut])
def list_recyclers(
    material_category: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.Recycler).filter(models.Recycler.authorization_status == "authorized")
    recyclers = q.all()
    results = []
    for r in recyclers:
        accepted = {x.strip() for x in (r.materials_accepted or "").split(",") if x.strip()}
        if material_category and material_category not in accepted:
            continue
        dist = haversine_km(lat, lng, r.lat, r.lng) if lat is not None and lng is not None else None
        out = schemas.RecyclerOut(
            id=r.id, name=r.name, facility_location=r.facility_location,
            lat=r.lat, lng=r.lng, materials_accepted=r.materials_accepted,
            authorization_status=r.authorization_status, contact=r.contact,
            pickup_available=r.pickup_available, distance_km=round(dist, 1) if dist is not None else None,
        )
        results.append(out)
    if lat is not None and lng is not None:
        results.sort(key=lambda x: (x.distance_km if x.distance_km is not None else 9999))
    return results


# ---------------------------------------------------------------------------
# Material lots (digital lots + traceability + transactions)
# ---------------------------------------------------------------------------

@app.post("/lots", response_model=schemas.LotOut)
def create_lot(payload: schemas.LotCreate, db: Session = Depends(get_db)):
    entry = get_reference_price(db, payload.material_category, payload.collection_location_text)
    est_value = round(entry.buying_price * payload.approx_weight_kg, 2) if entry else None
    lot = models.MaterialLot(
        collector_id=payload.collector_id,
        material_category=payload.material_category,
        material_description=payload.material_description,
        image_ref=payload.image_ref,
        approx_weight_kg=payload.approx_weight_kg,
        condition=payload.condition,
        collection_lat=payload.collection_lat,
        collection_lng=payload.collection_lng,
        collection_location_text=payload.collection_location_text,
        collected_at=payload.collected_at or datetime.utcnow(),
        estimated_value=est_value,
        quoted_price=est_value,
        status="available" if est_value else "draft",
        client_local_id=payload.client_local_id,
    )
    db.add(lot)
    db.commit()
    db.refresh(lot)
    return lot


@app.get("/lots/{lot_id}", response_model=schemas.LotOut)
def get_lot(lot_id: str, db: Session = Depends(get_db)):
    lot = db.query(models.MaterialLot).get(lot_id)
    if not lot:
        raise HTTPException(404, "Lot not found")
    return lot


@app.get("/collectors/{collector_id}/lots", response_model=List[schemas.LotOut])
def list_collector_lots(collector_id: str, db: Session = Depends(get_db)):
    return (
        db.query(models.MaterialLot)
        .filter(models.MaterialLot.collector_id == collector_id)
        .order_by(models.MaterialLot.collected_at.desc())
        .all()
    )


@app.post("/lots/{lot_id}/accept")
def accept_lot(lot_id: str, authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    session = current_auth(authorization)
    if session.get("role") != "recycler":
        raise HTTPException(403, "Recycler access required")
    r = db.query(models.Recycler).get(session["user_id"])
    lot = db.query(models.MaterialLot).get(lot_id)
    if not lot:
        raise HTTPException(404, "Lot not found")
    accepted = {x.strip() for x in (r.materials_accepted or "").split(",") if x.strip()}
    if lot.material_category not in accepted:
        raise HTTPException(409, f"This recycler does not accept {lot.material_category}")
    if lot.status not in {"available", "quoted", "matched"}:
        raise HTTPException(409, "This lot is no longer available for acceptance")
    if lot.matched_recycler_id and lot.matched_recycler_id != r.id:
        raise HTTPException(409, "This lot has already been matched to another recycler")
    lot.matched_recycler_id = r.id
    lot.status = "matched"
    db.commit(); db.refresh(lot)
    return {"lot_id": lot.id, "status": lot.status, "matched_recycler": {"id": r.id, "name": r.name}}


@app.post("/lots/{lot_id}/match")
def match_recycler(lot_id: str, lat: float, lng: float, db: Session = Depends(get_db)):
    lot = db.query(models.MaterialLot).get(lot_id)
    if not lot:
        raise HTTPException(404, "Lot not found")
    candidates = list_recyclers(material_category=lot.material_category, lat=lat, lng=lng, db=db)
    if not candidates:
        raise HTTPException(404, "No authorized recycler found for this material nearby")
    best = candidates[0]
    lot.matched_recycler_id = best.id
    lot.status = "matched"
    db.commit()
    return {"lot_id": lot_id, "matched_recycler": best}


@app.post("/handover")
def handover(payload: schemas.HandoverRequest, db: Session = Depends(get_db)):
    lot = db.query(models.MaterialLot).get(payload.lot_id)
    if not lot:
        raise HTTPException(404, "Lot not found")
    ref = models.gen_id("HOV")
    lot.handover_ref = ref
    lot.handover_timestamp = datetime.utcnow()
    lot.handover_lat = payload.handover_lat
    lot.handover_lng = payload.handover_lng
    lot.matched_recycler_id = payload.recycler_id
    lot.status = "handed_over"
    lot.final_sale_value = payload.final_sale_value or lot.quoted_price
    lot.payment_mode = payload.payment_mode
    lot.payment_status = "paid" if payload.payment_mode else "pending"

    is_anomaly, reason = detect_anomaly(db, lot.material_category, lot.final_sale_value or 0, lot.approx_weight_kg)
    lot.flagged_anomaly = is_anomaly
    lot.flag_reason = reason

    db.commit()
    return {
        "handover_ref": ref,
        "lot_id": lot.id,
        "timestamp": lot.handover_timestamp.isoformat(),
        "gps": {"lat": payload.handover_lat, "lng": payload.handover_lng},
        "flagged_anomaly": is_anomaly,
        "flag_reason": reason,
    }


@app.post("/handover/{handover_ref}/confirm")
def confirm_handover(handover_ref: str, db: Session = Depends(get_db)):
    lot = db.query(models.MaterialLot).filter(models.MaterialLot.handover_ref == handover_ref).first()
    if not lot:
        raise HTTPException(404, "Handover record not found")
    lot.recycler_confirmed = True
    lot.status = "confirmed"
    db.commit()
    return {"handover_ref": handover_ref, "confirmed": True}


# ---------------------------------------------------------------------------
# Earnings ledger
# ---------------------------------------------------------------------------

@app.get("/collectors/{collector_id}/ledger")
def earnings_ledger(collector_id: str, db: Session = Depends(get_db)):
    lots = (
        db.query(models.MaterialLot)
        .filter(models.MaterialLot.collector_id == collector_id)
        .order_by(models.MaterialLot.collected_at.desc())
        .all()
    )
    total_paid = sum(l.final_sale_value or 0 for l in lots if l.payment_status == "paid")
    pending = sum(l.quoted_price or 0 for l in lots if l.payment_status != "paid" and l.status != "draft")
    return {
        "collector_id": collector_id,
        "total_paid": round(total_paid, 2),
        "pending_dues": round(pending, 2),
        "transaction_count": len(lots),
        "transactions": [
            {
                "lot_id": l.id, "category": l.material_category, "weight": l.approx_weight_kg,
                "quoted_price": l.quoted_price, "final_sale_value": l.final_sale_value,
                "status": l.status, "payment_status": l.payment_status,
                "date": l.collected_at.isoformat(),
            } for l in lots
        ],
    }


# ---------------------------------------------------------------------------
# Offline sync endpoint — the core "offline-first" contract
# ---------------------------------------------------------------------------

@app.post("/sync/push", response_model=List[schemas.SyncPushResult])
def sync_push(req: schemas.SyncPushRequest, db: Session = Depends(get_db)):
    """
    App queues lots created while offline (each tagged with a client_local_id)
    and pushes them here once connectivity returns. Idempotent on client_local_id.
    """
    results = []
    for item in req.items:
        existing = (
            db.query(models.MaterialLot)
            .filter(models.MaterialLot.client_local_id == item.client_local_id)
            .first()
        )
        if existing:
            results.append(schemas.SyncPushResult(
                client_local_id=item.client_local_id, server_id=existing.id, status="already_synced"
            ))
            continue
        lot_out = create_lot(item.lot, db)
        results.append(schemas.SyncPushResult(
            client_local_id=item.client_local_id, server_id=lot_out.id, status="synced"
        ))
    return results


@app.get("/sync/pull")
def sync_pull(since: Optional[str] = None, db: Session = Depends(get_db)):
    """App calls this on reconnect to refresh its local price-board / recycler cache."""
    return {
        "price_board": price_board(db=db),
        "recyclers": [r.__dict__ for r in db.query(models.Recycler).all()],
        "server_time": datetime.utcnow().isoformat(),
    }


# ---------------------------------------------------------------------------
# Seed data for demo
# ---------------------------------------------------------------------------

@app.post("/seed")
def seed(db: Session = Depends(get_db)):
    """Idempotent hackathon demo seed: adds missing demo accounts, recyclers and prices."""
    demo_recyclers = [
        dict(name="Nashik Green E-Cycle Centre", phone="+919800000001", facility_location="Nashik MIDC", lat=19.9975, lng=73.7898, materials_accepted="PCB,cable,battery,motor,LCD", authorization_id="DEMO-MPCB-1001", contact="+91 98000 00001", pickup_available=True, service_area_km=30),
        dict(name="Kopargaon Circular Recycling Hub", phone="+919800000002", facility_location="Kopargaon", lat=19.8825, lng=74.4759, materials_accepted="CRT,LCD,PCB,mixed_plastic,glass", authorization_id="DEMO-MPCB-1002", contact="+91 98000 00002", pickup_available=True, service_area_km=25),
        dict(name="Ahilyanagar E-Waste Recovery Centre", phone="+919800000003", facility_location="Ahilyanagar", lat=19.0948, lng=74.7480, materials_accepted="cable,battery,motor,PCB,metal,power_supply", authorization_id="DEMO-MPCB-1003", contact="+91 98000 00003", pickup_available=False, service_area_km=20),
        dict(name="Sinnar Responsible Recycling Facility", phone="+919800000004", facility_location="Sinnar", lat=19.8457, lng=73.9985, materials_accepted="PCB,cable,LCD,motor,metal", authorization_id="DEMO-MPCB-1004", contact="+91 98000 00004", pickup_available=True, service_area_km=35),
        dict(name="Yeola Circular Metals Centre", phone="+919800000005", facility_location="Yeola", lat=20.0430, lng=74.4890, materials_accepted="metal,cable,PCB,motor", authorization_id="DEMO-MPCB-1005", contact="+91 98000 00005", pickup_available=True, service_area_km=30),
        dict(name="Igatpuri Eco Recovery Centre", phone="+919800000006", facility_location="Igatpuri", lat=19.6950, lng=73.5620, materials_accepted="battery,LCD,CRT,motor,glass", authorization_id="DEMO-MPCB-1006", contact="+91 98000 00006", pickup_available=True, service_area_km=40),
        dict(name="Nashik Plastic Recovery Centre", phone="+919800000007", facility_location="Nashik", lat=19.9975, lng=73.7890, materials_accepted="mixed_plastic", authorization_id="DEMO-MPCB-1007", contact="+91 98000 00007", pickup_available=True, service_area_km=40),
        dict(name="Ahilyanagar Metal Circular Works", phone="+919800000008", facility_location="Ahilyanagar", lat=19.0945, lng=74.7485, materials_accepted="metal", authorization_id="DEMO-MPCB-1008", contact="+91 98000 00008", pickup_available=True, service_area_km=35),
        dict(name="Kopargaon Plastics & Polymer Recovery", phone="+919800000009", facility_location="Kopargaon", lat=19.8830, lng=74.4765, materials_accepted="mixed_plastic", authorization_id="DEMO-MPCB-1009", contact="+91 98000 00009", pickup_available=False, service_area_km=25),
        dict(name="Sinnar Ferrous & Non-Ferrous Recycler", phone="+919800000010", facility_location="Sinnar", lat=19.8460, lng=73.9989, materials_accepted="metal,PCB,cable", authorization_id="DEMO-MPCB-1010", contact="+91 98000 00010", pickup_available=True, service_area_km=35),
        dict(name="Nashik Data Secure Drive Recycler", phone="+919800000011", facility_location="Nashik", lat=20.0010, lng=73.7860, materials_accepted="hard_drive", authorization_id="DEMO-MPCB-1011", contact="+91 98000 00011", pickup_available=True, service_area_km=45),
        dict(name="Nashik Power Electronics Recovery", phone="+919800000012", facility_location="Nashik", lat=19.9950, lng=73.7850, materials_accepted="power_supply", authorization_id="DEMO-MPCB-1012", contact="+91 98000 00012", pickup_available=True, service_area_km=35),
        dict(name="Kopargaon Mobile & Small Electronics", phone="+919800000013", facility_location="Kopargaon", lat=19.8850, lng=74.4740, materials_accepted="mobile,PCB,battery", authorization_id="DEMO-MPCB-1013", contact="+91 98000 00013", pickup_available=True, service_area_km=30),
        dict(name="Ahilyanagar Printer Recovery Centre", phone="+919800000014", facility_location="Ahilyanagar", lat=19.0960, lng=74.7460, materials_accepted="printer,PCB,mixed_plastic", authorization_id="DEMO-MPCB-1014", contact="+91 98000 00014", pickup_available=False, service_area_km=30),
        dict(name="Nashik Peripheral Recycling Hub", phone="+919800000015", facility_location="Nashik", lat=19.9990, lng=73.7905, materials_accepted="keyboard_mouse,mixed_plastic,PCB", authorization_id="DEMO-MPCB-1015", contact="+91 98000 00015", pickup_available=True, service_area_km=40),
        dict(name="Nashik Copper & Cable Recovery", phone="+919800000016", facility_location="Nashik", lat=20.0020, lng=73.7880, materials_accepted="copper,cable", authorization_id="DEMO-MPCB-1016", contact="+91 98000 00016", pickup_available=True, service_area_km=40),
        dict(name="Ahilyanagar Aluminum & Steel Recycler", phone="+919800000017", facility_location="Ahilyanagar", lat=19.0970, lng=74.7490, materials_accepted="aluminum,ferrous_metal,stainless_steel,metal", authorization_id="DEMO-MPCB-1017", contact="+91 98000 00017", pickup_available=True, service_area_km=45),
        dict(name="Kopargaon Small Electronics Recovery", phone="+919800000018", facility_location="Kopargaon", lat=19.8860, lng=74.4770, materials_accepted="router,camera,speaker,game_console,small_appliance,PCB", authorization_id="DEMO-MPCB-1018", contact="+91 98000 00018", pickup_available=True, service_area_km=35),
        dict(name="Sinnar Solar & LED Recovery Centre", phone="+919800000019", facility_location="Sinnar", lat=19.8480, lng=73.9970, materials_accepted="solar_panel,led_bulb,glass", authorization_id="DEMO-MPCB-1019", contact="+91 98000 00019", pickup_available=False, service_area_km=50),
        dict(name="Nashik Rubber, Paper & Packaging Recovery", phone="+919800000020", facility_location="Nashik", lat=19.9960, lng=73.7830, materials_accepted="rubber,cardboard,paper,textile,mixed_plastic", authorization_id="DEMO-MPCB-1020", contact="+91 98000 00020", pickup_available=True, service_area_km=40),
    ]
    added_recyclers = 0
    for data in demo_recyclers:
        r = db.query(models.Recycler).filter(models.Recycler.phone == data["phone"]).first()
        if not r:
            r = models.Recycler(**data, password_hash=hash_password("demo1234"), authorization_status="authorized", verification_status="approved")
            db.add(r)
            added_recyclers += 1
        else:
            r.password_hash = hash_password("demo1234")
            r.authorization_status = "authorized"
            r.verification_status = "approved"
    db.commit()

    categories = {
        "PCB": 233.2, "cable": 100.7, "battery": 63.6, "CRT": 8.5,
        "LCD": 42.4, "motor": 72.8, "mixed_plastic": 18.2, "metal": 54.5,
        "hard_drive": 96.0, "power_supply": 48.0, "mobile": 145.0, "printer": 31.0,
        "keyboard_mouse": 28.0, "glass": 12.0, "ferrous_metal": 32.0, "aluminum": 142.0,
        "copper": 585.0, "stainless_steel": 78.0, "brass": 420.0, "rubber": 16.0,
        "router": 72.0, "camera": 118.0, "speaker": 54.0, "game_console": 110.0,
        "solar_panel": 18.0, "led_bulb": 24.0, "small_appliance": 36.0,
        "cardboard": 10.0, "paper": 14.0, "textile": 12.0
    }
    locations = ["Nashik", "Kopargaon", "Ahilyanagar"]
    added_prices = 0
    for cat, base in categories.items():
        for loc in locations:
            exists = db.query(models.PriceEntry).filter(models.PriceEntry.material_category == cat, models.PriceEntry.location == loc).first()
            if not exists:
                entry = models.PriceEntry(material_category=cat, location=loc, buying_price=base, unit="kg", market_range_low=round(base*0.9,1), market_range_high=round(base*1.15,1))
                db.add(entry)
                added_prices += 1
    db.commit()

    collector = db.query(models.Collector).filter(models.Collector.phone == "9999999999").first()
    if not collector:
        collector = models.Collector(name="Demo Collector", phone="9999999999", password_hash=hash_password("demo1234"), certification_number="DEMO-CERT-001", verification_status="approved", preferred_language="mr", operating_location="Kopargaon", lat=19.8825, lng=74.4759)
        db.add(collector)
    else:
        collector.password_hash = hash_password("demo1234")
        collector.verification_status = "approved"
    db.commit()
    db.refresh(collector)

    return {"status": "seeded", "demo_collector_id": collector.id, "recyclers_added": added_recyclers, "prices_added": added_prices}


@app.get("/")
def root():
    return {"status": "ok", "docs": "/docs"}
