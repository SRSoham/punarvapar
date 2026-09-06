from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class LoginRequest(BaseModel):
    phone: str
    password: str
    role: str  # collector / recycler


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AuthOut(BaseModel):
    token: str
    role: str
    user: dict


class RecyclerRegistration(BaseModel):
    name: str
    phone: str
    password: str
    facility_location: str
    authorization_id: str
    contact: str
    lat: float = 0
    lng: float = 0


class CollectorRegistration(BaseModel):
    name: str
    phone: str
    password: str
    certification_number: str
    operating_location: str
    preferred_language: str = "mr"


class CollectorCreate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    preferred_language: str = "mr"
    operating_location: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    certification_number: Optional[str] = None
    certification_file: Optional[str] = None
    verification_status: Optional[str] = None


class CollectorOut(CollectorCreate):
    id: str
    created_at: datetime
    class Config:
        from_attributes = True


class ValuationRequest(BaseModel):
    material_category: str
    approx_weight_kg: float
    location: Optional[str] = None
    condition: Optional[str] = None


class ValuationResponse(BaseModel):
    material_category: str
    approx_weight_kg: float
    estimated_unit_price: float
    estimated_value: float
    market_range_low: Optional[float]
    market_range_high: Optional[float]
    price_trend: str
    source: str  # "cached_offline" or "live"


class LotCreate(BaseModel):
    client_local_id: Optional[str] = None
    collector_id: str
    material_category: str
    material_description: Optional[str] = None
    image_ref: Optional[str] = None
    approx_weight_kg: float
    condition: Optional[str] = None
    collection_lat: Optional[float] = None
    collection_lng: Optional[float] = None
    collection_location_text: Optional[str] = None
    collected_at: Optional[datetime] = None


class LotOut(BaseModel):
    id: str
    collector_id: str
    material_category: str
    material_description: Optional[str]
    approx_weight_kg: float
    estimated_value: Optional[float]
    quoted_price: Optional[float]
    final_sale_value: Optional[float]
    status: str
    matched_recycler_id: Optional[str]
    handover_ref: Optional[str]
    payment_status: str
    flagged_anomaly: bool
    collected_at: datetime
    class Config:
        from_attributes = True


class HandoverRequest(BaseModel):
    lot_id: str
    recycler_id: str
    handover_lat: float
    handover_lng: float
    final_sale_value: Optional[float] = None
    payment_mode: Optional[str] = "cash"


class RecyclerOut(BaseModel):
    id: str
    name: str
    facility_location: str
    lat: float
    lng: float
    materials_accepted: str
    authorization_status: str
    contact: str
    pickup_available: bool
    distance_km: Optional[float] = None
    class Config:
        from_attributes = True


class SyncPushItem(BaseModel):
    client_local_id: str
    lot: LotCreate


class SyncPushRequest(BaseModel):
    items: List[SyncPushItem]


class SyncPushResult(BaseModel):
    client_local_id: str
    server_id: str
    status: str
