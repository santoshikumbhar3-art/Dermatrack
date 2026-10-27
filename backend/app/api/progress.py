from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CheckIn, RoutineItem
from ..schemas import CheckInIn
from ..services.adaptive_guidance import RED_FLAG_LABELS, SYMPTOM_LABELS, build_guidance
from ..services.progress_service import build_progress
from .serializers import checkin_out

router = APIRouter(prefix="/api", tags=["progress"])


@router.get("/progress")
def progress(days: int | None = Query(default=None, ge=1, le=3650), db: Session = Depends(get_db)) -> dict:
    return build_progress(db, days)


@router.get("/checkins")
def list_checkins(db: Session = Depends(get_db)) -> dict:
    return {
        "checkins": [checkin_out(c) for c in db.scalars(select(CheckIn).order_by(CheckIn.created_at.desc()))],
        "symptom_labels": SYMPTOM_LABELS,
        "red_flag_labels": RED_FLAG_LABELS,
    }


@router.post("/checkins", status_code=201)
def create_checkin(body: CheckInIn, db: Session = Depends(get_db)) -> dict:
    valid_ids = {i for (i,) in db.execute(select(RoutineItem.id))}
    bad = [i for i in body.suspected_item_ids if i not in valid_ids]
    if bad:
        raise HTTPException(422, detail={"code": "invalid_product", "message": "One of the suspected products no longer exists."})
    c = CheckIn(**body.model_dump())
    db.add(c)
    db.commit()
    return {"checkin": checkin_out(c), "guidance": build_guidance(db)}


@router.delete("/checkins/{checkin_id}", status_code=204)
def delete_checkin(checkin_id: int, db: Session = Depends(get_db)) -> None:
    c = db.get(CheckIn, checkin_id)
    if not c:
        raise HTTPException(404, detail={"code": "not_found", "message": "Check-in not found."})
    db.delete(c)
    db.commit()


@router.get("/guidance")
def guidance(db: Session = Depends(get_db)) -> dict:
    return build_guidance(db)
