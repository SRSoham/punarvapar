import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Float, Integer, DateTime, Boolean, ForeignKey, Text
)
from sqlalchemy.orm import relationship

from database import Base


def gen_id(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


class Collector(Base):
    """Minimal collector profile — no unnecessary personal info."""
    __tablename__ = "collectors"
    id = Column(String, primary_key=True, default=lambda: gen_id("COL"))
    name = Column(String, nullable=True)          # optional
    phone = Column(String, nullable=True, unique=True)
    preferred_language = Column(String, default="mr")  # mr / hi / en
    operating_location = Column(String, nullable=True)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    password_hash = Column(String, nullable=True)
    certification_number = Column(String, nullable=True)
    certification_file = Column(String, nullable=True)
    verification_status = Column(String, default="approved")  # pending/approved/rejected

    lots = relationship("MaterialLot", back_populates="collector")


class Recycler(Base):
    """Authorized recycler / aggregator dataset."""
    __tablename__ = "recyclers"
    id = Column(String, primary_key=True, default=lambda: gen_id("REC"))
    name = Column(String, nullable=False)
    facility_location = Column(String, nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    materials_accepted = Column(String)  # comma separated categories
    authorization_id = Column(String)
    authorization_status = Column(String, default="authorized")  # authorized/pending/revoked
    contact = Column(String)
    offered_rate_note = Column(String, nullable=True)
    pickup_available = Column(Boolean, default=True)
    service_area_km = Column(Float, default=15.0)
    phone = Column(String, nullable=True, unique=True)
    password_hash = Column(String, nullable=True)
    certification_file = Column(String, nullable=True)
    verification_status = Column(String, default="approved")  # pending/approved/rejected


class PriceEntry(Base):
    """Price discovery / historical price dataset."""
    __tablename__ = "price_entries"
    id = Column(String, primary_key=True, default=lambda: gen_id("PRC"))
    material_category = Column(String, nullable=False)
    sub_category = Column(String, nullable=True)
    location = Column(String, nullable=False)
    date = Column(DateTime, default=datetime.utcnow)
    buying_price = Column(Float, nullable=False)
    unit = Column(String, default="kg")
    market_range_low = Column(Float, nullable=True)
    market_range_high = Column(Float, nullable=True)
    recycler_id = Column(String, ForeignKey("recyclers.id"), nullable=True)


class MaterialLot(Base):
    """Material + transaction dataset — one row per collected lot."""
    __tablename__ = "material_lots"
    id = Column(String, primary_key=True, default=lambda: gen_id("LOT"))
    collector_id = Column(String, ForeignKey("collectors.id"))
    material_category = Column(String, nullable=False)  # CRT, LCD, PCB, cable, battery, motor, mixed_plastic...
    material_description = Column(String, nullable=True)
    image_ref = Column(Text, nullable=True)  # base64 or file path/URL
    approx_weight_kg = Column(Float, nullable=False)
    condition = Column(String, nullable=True)
    source_type = Column(String, default="informal_collection")
    estimated_value = Column(Float, nullable=True)
    quoted_price = Column(Float, nullable=True)
    final_sale_value = Column(Float, nullable=True)
    collection_lat = Column(Float, nullable=True)
    collection_lng = Column(Float, nullable=True)
    collection_location_text = Column(String, nullable=True)
    collected_at = Column(DateTime, default=datetime.utcnow)
    matched_recycler_id = Column(String, ForeignKey("recyclers.id"), nullable=True)
    status = Column(String, default="draft")
    # draft -> quoted -> matched -> handed_over -> paid -> flagged
    handover_ref = Column(String, nullable=True)
    handover_timestamp = Column(DateTime, nullable=True)
    handover_lat = Column(Float, nullable=True)
    handover_lng = Column(Float, nullable=True)
    recycler_confirmed = Column(Boolean, default=False)
    payment_status = Column(String, default="unpaid")
    payment_mode = Column(String, nullable=True)  # cash / digital
    client_local_id = Column(String, nullable=True)  # for offline dedup on sync
    flagged_anomaly = Column(Boolean, default=False)
    flag_reason = Column(String, nullable=True)

    collector = relationship("Collector", back_populates="lots")
