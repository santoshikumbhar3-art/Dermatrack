from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .services.adaptive_guidance import RED_FLAG_LABELS, SYMPTOM_LABELS

Slot = Literal["am", "pm", "both"]
Frequency = Literal["daily", "alternate_days", "2_3_week", "weekly", "as_needed"]
Category = Literal[
    "cleanser", "toner", "serum", "exfoliant", "treatment", "moisturiser", "sunscreen", "eye", "mask", "oil", "other"
]


class ActiveIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    concentration_percent: float | None = Field(default=None, ge=0, le=100)

    @field_validator("name")
    @classmethod
    def strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Ingredient name cannot be empty")
        return v


class RoutineItemIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=160)
    brand: str = Field(default="", max_length=120)
    category: Category = "other"
    slot: Slot = "pm"
    step_order: int = Field(default=0, ge=0, le=50)
    actives: list[ActiveIn] = Field(default_factory=list, max_length=20)
    ingredients_verified: bool = False
    frequency: Frequency = "daily"
    introduced_on: date | None = None
    instructions: str = Field(default="", max_length=1000)
    paused: bool = False
    notes: str = Field(default="", max_length=1000)
    library_product_id: int | None = None

    @field_validator("introduced_on")
    @classmethod
    def not_future(cls, v: date | None) -> date | None:
        if v and v > date.today():
            raise ValueError("Start date can't be in the future")
        return v


class ReactionIn(BaseModel):
    description: str = Field(min_length=2, max_length=500)
    severity: int = Field(ge=1, le=3)


class CheckInIn(BaseModel):
    symptoms: dict[str, int] = Field(default_factory=dict)
    red_flags: list[str] = Field(default_factory=list)
    confounders: list[str] = Field(default_factory=list, max_length=12)
    suspected_item_ids: list[int] = Field(default_factory=list)
    notes: str = Field(default="", max_length=2000)

    @field_validator("symptoms")
    @classmethod
    def valid_symptoms(cls, v: dict[str, int]) -> dict[str, int]:
        for k, s in v.items():
            if k not in SYMPTOM_LABELS:
                raise ValueError(f"Unknown symptom '{k}'")
            if not 0 <= int(s) <= 3:
                raise ValueError("Symptom severity must be 0–3")
        return {k: int(s) for k, s in v.items()}

    @field_validator("red_flags")
    @classmethod
    def valid_flags(cls, v: list[str]) -> list[str]:
        bad = [f for f in v if f not in RED_FLAG_LABELS]
        if bad:
            raise ValueError(f"Unknown warning sign(s): {', '.join(bad)}")
        return sorted(set(v))

    @field_validator("confounders")
    @classmethod
    def clean_conf(cls, v: list[str]) -> list[str]:
        return [c.strip()[:60] for c in v if c.strip()]


class ProfileIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    display_name: str = Field(default="", max_length=80)
    skin_goals: list[str] = Field(default_factory=list, max_length=8)
    budget_max: float | None = Field(default=None, ge=0, le=1_000_000)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    avoid_fragrance: bool = False
    checkin_interval_days: int = Field(default=7, ge=1, le=60)


class ConsentIn(BaseModel):
    analysis_consent: bool
    consent_version: str = Field(default="2026-10", max_length=20)


class LibraryProductIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=160)
    brand: str = Field(min_length=1, max_length=120)
    category: Category
    key_actives: list[ActiveIn] = Field(default_factory=list, max_length=20)
    attributes: list[str] = Field(default_factory=list, max_length=12)
    fragrance_free: bool | None = None
    price: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    price_source: str = Field(default="", max_length=200)
    instructions: str = Field(default="", max_length=1000)
    source: str = Field(default="", max_length=300)


class AssistantIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class CheckRoutineIn(BaseModel):
    """Evaluate an arbitrary (unsaved) set of products — used for previews."""

    items: list[RoutineItemIn] = Field(max_length=30)
