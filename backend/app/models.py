"""SQLAlchemy models.

This is a single-user hackathon prototype: there is one local profile and no
authentication layer. Every record carries an ``is_demo`` flag so the clearly
labelled demonstration dataset can be loaded and removed without touching the
user's own data.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Profile(Base):
    __tablename__ = "profile"

    id: Mapped[int] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(80), default="")
    skin_goals: Mapped[list] = mapped_column(JSON, default=list)
    budget_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    avoid_fragrance: Mapped[bool] = mapped_column(Boolean, default=False)
    analysis_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    analysis_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consent_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    checkin_interval_days: Mapped[int] = mapped_column(Integer, default=7)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Analysis(Base):
    __tablename__ = "analysis"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    # youcam | dev_fixture | demo_sample
    source: Mapped[str] = mapped_column(String(20))
    # sd | hd — scores are only compared within the same mode and api_version
    mode: Mapped[str] = mapped_column(String(4))
    api_version: Mapped[str] = mapped_column(String(20), default="s2s/v2.0")
    provider_task_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    skin_age: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Normalised metrics: list of {key, label, raw_score, ui_score, region}
    metrics: Mapped[list] = mapped_column(JSON, default=list)
    unmapped_fields: Mapped[list] = mapped_column(JSON, default=list)
    image_meta: Mapped[dict] = mapped_column(JSON, default=dict)  # width, height, format, bytes (never the image)
    capture_conditions: Mapped[dict] = mapped_column(JSON, default=dict)  # user-declared lighting etc.
    raw_response_redacted: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class CheckIn(Base):
    __tablename__ = "checkin"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    # Self-reported symptom severities, 0 (none) .. 3 (severe)
    symptoms: Mapped[dict] = mapped_column(JSON, default=dict)
    # Warning signs (e.g. "blistering", "difficulty_breathing") — drive safety rules
    red_flags: Mapped[list] = mapped_column(JSON, default=list)
    # Product ids the user suspects, if any
    suspected_item_ids: Mapped[list] = mapped_column(JSON, default=list)
    # Free-form flags that can confound comparisons (travel, sun exposure, illness...)
    confounders: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class RoutineItem(Base):
    __tablename__ = "routine_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    brand: Mapped[str] = mapped_column(String(120), default="")
    category: Mapped[str] = mapped_column(String(40), default="other")
    slot: Mapped[str] = mapped_column(String(8), default="pm")  # am | pm | both
    step_order: Mapped[int] = mapped_column(Integer, default=0)
    # [{name: str, concentration_percent: float | None}]
    actives: Mapped[list] = mapped_column(JSON, default=list)
    ingredients_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    frequency: Mapped[str] = mapped_column(String(20), default="daily")
    introduced_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    instructions: Mapped[str] = mapped_column(Text, default="")
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    library_product_id: Mapped[int | None] = mapped_column(ForeignKey("library_product.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    reactions: Mapped[list["Reaction"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", order_by="Reaction.created_at"
    )


class RoutineEvent(Base):
    """Append-only log of routine changes, used for timeline annotations."""

    __tablename__ = "routine_event"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    item_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # survives item deletion
    item_name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(12))  # added | edited | paused | resumed | removed
    detail: Mapped[str] = mapped_column(Text, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class Reaction(Base):
    __tablename__ = "reaction"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("routine_item.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    description: Mapped[str] = mapped_column(Text)
    severity: Mapped[int] = mapped_column(Integer, default=1)  # 1 mild, 2 moderate, 3 severe
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    item: Mapped[RoutineItem] = relationship(back_populates="reactions")


class LibraryProduct(Base):
    __tablename__ = "library_product"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    brand: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(40))
    key_actives: Mapped[list] = mapped_column(JSON, default=list)
    full_ingredients: Mapped[list] = mapped_column(JSON, default=list)
    ingredients_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    attributes: Mapped[list] = mapped_column(JSON, default=list)  # e.g. ["hydration", "fragrance-free"]
    fragrance_free: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    price_source: Mapped[str] = mapped_column(String(200), default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(300), default="")
    limitations: Mapped[str] = mapped_column(Text, default="")
    user_added: Mapped[bool] = mapped_column(Boolean, default=False)
