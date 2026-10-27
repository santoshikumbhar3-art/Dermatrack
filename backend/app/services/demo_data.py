"""Clearly labelled demonstration dataset.

Every record created here has ``is_demo=True`` and scans use
``source="demo_sample"``. The UI shows a persistent "Demonstration data"
banner while any demo record exists. Values are illustrative, are NOT YouCam
measurements of a real person, and deliberately include mixed and unclear
changes rather than a tidy success story.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import Analysis, CheckIn, Reaction, RoutineEvent, RoutineItem
from .analysis_normalizer import SD_CONCERNS, canonical_key

# raw scores per scan (day offset -> values); higher = more favourable
_SCANS = [
    (-28, {"acne": 71.2, "pore": 63.5, "texture": 66.0, "wrinkle": 74.1, "redness": 70.3, "oiliness": 55.8, "moisture": 49.6, "radiance": 68.9}, 66.4),
    (-20, {"acne": 72.0, "pore": 64.1, "texture": 67.2, "wrinkle": 73.6, "redness": 69.8, "oiliness": 57.0, "moisture": 50.4, "radiance": 69.5}, 67.0),
    (-11, {"acne": 74.9, "pore": 64.8, "texture": 70.1, "wrinkle": 74.4, "redness": 64.2, "oiliness": 58.1, "moisture": 47.9, "radiance": 70.2}, 67.6),
    (-2, {"acne": 76.8, "pore": 65.3, "texture": 71.6, "wrinkle": 74.0, "redness": 66.0, "oiliness": 59.4, "moisture": 49.1, "radiance": 71.0}, 68.3),
]


def _ui(raw: float) -> int:
    # Illustrative only: mimics the provider's upward display adjustment.
    return int(round(min(99, 40 + raw * 0.55)))


def has_demo(db: Session) -> bool:
    return any(
        db.scalar(select(m.id).where(m.is_demo.is_(True)).limit(1)) is not None
        for m in (Analysis, CheckIn, RoutineItem, RoutineEvent)
    )


def clear_demo(db: Session) -> None:
    db.execute(delete(Reaction).where(Reaction.is_demo.is_(True)))
    for m in (Analysis, CheckIn, RoutineEvent, RoutineItem):
        db.execute(delete(m).where(m.is_demo.is_(True)))
    db.commit()


def load_demo(db: Session) -> None:
    clear_demo(db)
    now = datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0)
    for offset, vals, overall in _SCANS:
        db.add(
            Analysis(
                created_at=now + timedelta(days=offset),
                source="demo_sample",
                mode="sd",
                api_version="s2s/v2.0",
                overall_score=overall,
                skin_age=None,
                metrics=[
                    {
                        "key": k, "canonical": canonical_key(k), "label": SD_CONCERNS[k], "region": None, "region_label": None,
                        "raw_score": v, "ui_score": _ui(v), "direction": "higher_is_better", "scale": "1-100",
                    }
                    for k, v in vals.items()
                ],
                image_meta={},
                capture_conditions={"lighting": "Window daylight", "makeup": "None", "time_of_day": "Morning"},
                note="Demonstration sample — not a real measurement.",
                is_demo=True,
            )
        )

    def item(**kw):
        it = RoutineItem(is_demo=True, ingredients_verified=False, **kw)
        db.add(it)
        db.flush()
        return it

    today = now.date()
    cleanser = item(name="Hydrating Facial Cleanser", brand="CeraVe", category="cleanser", slot="both", step_order=1,
                    actives=[{"name": "ceramides"}, {"name": "hyaluronic acid"}], frequency="daily", introduced_on=today - timedelta(days=60))
    niacin = item(name="Niacinamide 10% Face Serum", brand="Minimalist", category="serum", slot="am", step_order=2,
                  actives=[{"name": "niacinamide", "concentration_percent": 10}], frequency="daily", introduced_on=today - timedelta(days=45))
    spf = item(name="Sunscreen SPF 50 PA++++", brand="Minimalist", category="sunscreen", slot="am", step_order=4,
               actives=[{"name": "sunscreen filters"}], frequency="daily", introduced_on=today - timedelta(days=60))
    moist = item(name="Moisturising Cream", brand="CeraVe", category="moisturiser", slot="both", step_order=3,
                 actives=[{"name": "ceramides"}], frequency="daily", introduced_on=today - timedelta(days=60))
    glyco = item(name="Glycolic Acid 7% Toning Solution", brand="The Ordinary", category="exfoliant", slot="pm", step_order=2,
                 actives=[{"name": "glycolic acid", "concentration_percent": 7}], frequency="2_3_week", introduced_on=today - timedelta(days=24),
                 instructions="Use in the evening. Avoid the eye area.")
    retinol = item(name="Retinol 0.5% in Squalane", brand="The Ordinary", category="treatment", slot="pm", step_order=3,
                   actives=[{"name": "retinol", "concentration_percent": 0.5}], frequency="daily", introduced_on=today - timedelta(days=14),
                   instructions="Start a few times a week. Use sunscreen during the day.")
    mystery = item(name="Hydrating toner (unknown ingredients)", brand="", category="toner", slot="pm", step_order=1,
                   actives=[], frequency="daily", introduced_on=None)

    for it, days_ago in ((cleanser, 30), (niacin, 30), (spf, 30), (moist, 30), (glyco, 24), (retinol, 14), (mystery, 6)):
        db.add(RoutineEvent(created_at=now - timedelta(days=days_ago), item_id=it.id, item_name=it.name, kind="added",
                            detail="Demonstration data", is_demo=True))

    db.add(Reaction(item_id=retinol.id, created_at=now - timedelta(days=8),
                    description="Tight, slightly flaky around the nose after the third night.", severity=1, is_demo=True))

    for days_ago, sym, conf, notes in (
        (21, {"dryness": 0, "irritation": 0}, [], "Skin feels normal."),
        (12, {"dryness": 1, "redness": 1, "peeling": 1}, ["more sun exposure"], "Slight flaking after starting retinol."),
        (4, {"dryness": 1, "irritation": 0, "redness": 0}, [], "Flaking settling down."),
    ):
        db.add(CheckIn(created_at=now - timedelta(days=days_ago), symptoms=sym, confounders=conf, notes=notes, red_flags=[], is_demo=True))
    db.commit()
