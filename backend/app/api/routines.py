from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CheckIn, Reaction, RoutineEvent, RoutineItem
from ..schemas import CheckRoutineIn, ReactionIn, RoutineItemIn
from ..services.ingredient_rules import build_product, evaluate, resolve, rules_catalog
from .serializers import event_out, item_out

router = APIRouter(prefix="/api", tags=["routine"])

TRACKED = {
    "name": "name", "brand": "brand", "slot": "time of day", "frequency": "frequency", "actives": "actives",
    "introduced_on": "start date", "instructions": "instructions", "category": "category",
}


def _not_found():
    raise HTTPException(404, detail={"code": "not_found", "message": "Routine product not found."})


def _evaluate_items(items: list[RoutineItem]) -> dict:
    prods = [build_product(i.id, i.name, i.slot, i.frequency, i.instructions, i.actives, i.ingredients_verified, i.paused) for i in items]
    return evaluate(prods, introduced={i.id: i.introduced_on for i in items if i.introduced_on})


@router.get("/routines")
def list_items(db: Session = Depends(get_db)) -> dict:
    items = list(db.scalars(select(RoutineItem).order_by(RoutineItem.step_order, RoutineItem.id)))
    return {"items": [item_out(i) for i in items], "compatibility": _evaluate_items(items)}


@router.post("/routines", status_code=201)
def create_item(body: RoutineItemIn, db: Session = Depends(get_db)) -> dict:
    data = body.model_dump()
    data["actives"] = [a for a in data["actives"]]
    item = RoutineItem(**data)
    db.add(item)
    db.flush()
    db.add(RoutineEvent(item_id=item.id, item_name=item.name, kind="added", detail=f"{item.slot.upper()} · {item.category}"))
    db.commit()
    return item_out(item)


@router.put("/routines/{item_id}")
def update_item(item_id: int, body: RoutineItemIn, db: Session = Depends(get_db)) -> dict:
    item = db.get(RoutineItem, item_id) or _not_found()
    new = body.model_dump()
    changes = []
    for k, label in TRACKED.items():
        if getattr(item, k) != new[k]:
            changes.append(label)
    was_paused = item.paused
    for k, v in new.items():
        setattr(item, k, v)
    if was_paused != item.paused:
        db.add(RoutineEvent(item_id=item.id, item_name=item.name, kind="paused" if item.paused else "resumed"))
    if changes:
        db.add(RoutineEvent(item_id=item.id, item_name=item.name, kind="edited", detail="Changed " + ", ".join(changes)))
    db.commit()
    return item_out(item)


@router.delete("/routines/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db)) -> None:
    item = db.get(RoutineItem, item_id) or _not_found()
    db.add(RoutineEvent(item_id=item.id, item_name=item.name, kind="removed", is_demo=item.is_demo))
    db.delete(item)
    db.commit()


@router.post("/routines/{item_id}/reactions", status_code=201)
def add_reaction(item_id: int, body: ReactionIn, db: Session = Depends(get_db)) -> dict:
    item = db.get(RoutineItem, item_id) or _not_found()
    item.reactions.append(Reaction(description=body.description.strip(), severity=body.severity))
    db.commit()
    return item_out(item)


@router.delete("/routines/{item_id}/reactions/{reaction_id}", status_code=204)
def delete_reaction(item_id: int, reaction_id: int, db: Session = Depends(get_db)) -> None:
    r = db.get(Reaction, reaction_id)
    if not r or r.item_id != item_id:
        raise HTTPException(404, detail={"code": "not_found", "message": "Reaction not found."})
    db.delete(r)
    db.commit()


@router.get("/routines/compatibility")
def compatibility(db: Session = Depends(get_db)) -> dict:
    return _evaluate_items(list(db.scalars(select(RoutineItem))))


@router.post("/routines/compatibility/preview")
def compatibility_preview(body: CheckRoutineIn) -> dict:
    prods = [
        build_product(f"draft-{n}", i.name, i.slot, i.frequency, i.instructions, [a.model_dump() for a in i.actives], i.ingredients_verified, i.paused)
        for n, i in enumerate(body.items)
    ]
    return evaluate(prods)


@router.get("/routines/changes")
def changes_between(from_checkin: int | None = None, to_checkin: int | None = None, db: Session = Depends(get_db)) -> dict:
    """Routine changes between two check-ins (defaults to the last two)."""
    checkins = list(db.scalars(select(CheckIn).order_by(CheckIn.created_at)))
    if from_checkin and to_checkin:
        a, b = db.get(CheckIn, from_checkin), db.get(CheckIn, to_checkin)
        if not a or not b:
            raise HTTPException(404, detail={"code": "not_found", "message": "Check-in not found."})
        if a.created_at > b.created_at:
            a, b = b, a
    elif len(checkins) >= 2:
        a, b = checkins[-2], checkins[-1]
    else:
        return {"from": None, "to": None, "events": [], "message": "At least two check-ins are needed to compare routine changes."}
    events = list(
        db.scalars(
            select(RoutineEvent)
            .where(RoutineEvent.created_at >= a.created_at, RoutineEvent.created_at <= b.created_at)
            .order_by(RoutineEvent.created_at)
        )
    )
    return {
        "from": {"id": a.id, "at": a.created_at.isoformat()},
        "to": {"id": b.id, "at": b.created_at.isoformat()},
        "events": [event_out(e) for e in events],
        "message": None if events else "No routine changes were recorded between these check-ins.",
    }


@router.get("/routines/events")
def list_events(limit: int = 50, db: Session = Depends(get_db)) -> list[dict]:
    q = select(RoutineEvent).order_by(RoutineEvent.created_at.desc()).limit(min(max(limit, 1), 200))
    return [event_out(e) for e in db.scalars(q)]


@router.get("/rules")
def rules() -> list[dict]:
    return rules_catalog()


@router.get("/ingredients/resolve")
def resolve_ingredient(name: str) -> dict:
    canonical, family = resolve(name)
    return {"input": name, "canonical": canonical, "family": family, "recognised": canonical is not None}
