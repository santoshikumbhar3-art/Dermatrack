from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Analysis, CheckIn, LibraryProduct, Reaction, RoutineEvent, RoutineItem
from ..schemas import ConsentIn, ProfileIn
from ..services import demo_data
from ..services.adaptive_guidance import build_guidance
from ..services.assistant_service import assistant_status
from ..services.ingredient_rules import build_product, evaluate
from ..services.progress_service import build_progress
from ..services.recommendation_service import _lp_dict
from .deps import get_profile
from .serializers import analysis_out, checkin_out, event_out, item_out, profile_out

router = APIRouter(prefix="/api", tags=["account"])


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "analysis_source": settings.analysis_source,
        "youcam_configured": settings.youcam_configured,
        "youcam_mode": settings.youcam_mode,
        "assistant_mode": assistant_status()["mode"],
        "time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/profile")
def get_profile_ep(db: Session = Depends(get_db)) -> dict:
    return profile_out(get_profile(db))


@router.put("/profile")
def put_profile(body: ProfileIn, db: Session = Depends(get_db)) -> dict:
    p = get_profile(db)
    for k, v in body.model_dump().items():
        setattr(p, k, v.upper() if k == "currency" else v)
    db.commit()
    return profile_out(p)


@router.put("/consent")
def put_consent(body: ConsentIn, db: Session = Depends(get_db)) -> dict:
    p = get_profile(db)
    p.analysis_consent = body.analysis_consent
    p.analysis_consent_at = datetime.now(timezone.utc) if body.analysis_consent else None
    p.consent_version = body.consent_version if body.analysis_consent else None
    db.commit()
    return profile_out(p)


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    p = get_profile(db)
    scans = list(db.scalars(select(Analysis).order_by(Analysis.created_at.desc())))
    items = list(db.scalars(select(RoutineItem).order_by(RoutineItem.step_order)))
    events = list(db.scalars(select(RoutineEvent).order_by(RoutineEvent.created_at.desc()).limit(5)))
    checkins = list(db.scalars(select(CheckIn).order_by(CheckIn.created_at.desc()).limit(3)))
    compat = evaluate(
        [build_product(i.id, i.name, i.slot, i.frequency, i.instructions, i.actives, i.ingredients_verified, i.paused) for i in items],
        introduced={i.id: i.introduced_on for i in items if i.introduced_on},
    )
    reactions = sorted(
        [(r, i) for i in items for r in i.reactions], key=lambda t: t[0].created_at, reverse=True
    )[:3]
    prog = build_progress(db, 30)
    return {
        "profile": profile_out(p),
        "has_demo": demo_data.has_demo(db),
        "latest_scan": analysis_out(scans[0]) if scans else None,
        "scan_count": len(scans),
        "routine": {
            "am": [item_out(i) for i in items if i.slot in ("am", "both") and not i.paused],
            "pm": [item_out(i) for i in items if i.slot in ("pm", "both") and not i.paused],
            "paused": [item_out(i) for i in items if i.paused],
            "total": len(items),
        },
        "recent_changes": [event_out(e) for e in events],
        "alerts": [f for f in compat["findings"] if f["severity"] in ("documented_concern", "precaution")][:4],
        "alert_counts": compat["counts"],
        "recent_checkins": [checkin_out(c) for c in checkins],
        "recent_reactions": [
            {"item_id": i.id, "item_name": i.name, "description": r.description, "severity": r.severity, "created_at": r.created_at.isoformat()}
            for r, i in reactions
        ],
        "guidance": build_guidance(db),
        "trend": {"overall": prog["overall"], "summary": prog["summary"], "group": prog["group"]},
        "analysis_source": settings.analysis_source,
    }


@router.get("/export")
def export_all(db: Session = Depends(get_db)) -> dict:
    """Everything stored about the user. Photos are never stored, so none are included."""
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "note": "DermaTrack never stores your photos. This export contains scores, check-ins and routine records.",
        "profile": profile_out(get_profile(db)),
        "scans": [analysis_out(a, include_raw=True) for a in db.scalars(select(Analysis))],
        "checkins": [checkin_out(c) for c in db.scalars(select(CheckIn))],
        "routine": [item_out(i) for i in db.scalars(select(RoutineItem))],
        "routine_events": [event_out(e) for e in db.scalars(select(RoutineEvent))],
        "my_library_products": [_lp_dict(p) for p in db.scalars(select(LibraryProduct).where(LibraryProduct.user_added.is_(True)))],
    }


@router.delete("/data", status_code=204)
def delete_everything(db: Session = Depends(get_db)) -> None:
    db.execute(delete(Reaction))
    for m in (Analysis, CheckIn, RoutineEvent, RoutineItem):
        db.execute(delete(m))
    db.execute(delete(LibraryProduct).where(LibraryProduct.user_added.is_(True)))
    p = get_profile(db)
    db.delete(p)
    db.commit()


@router.delete("/analysis", status_code=204)
def delete_all_scans(db: Session = Depends(get_db)) -> None:
    db.execute(delete(Analysis))
    db.commit()


@router.post("/demo/load", status_code=201)
def demo_load(db: Session = Depends(get_db)) -> dict:
    demo_data.load_demo(db)
    return {"loaded": True}


@router.delete("/demo", status_code=204)
def demo_clear(db: Session = Depends(get_db)) -> None:
    demo_data.clear_demo(db)
