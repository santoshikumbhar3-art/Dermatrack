from __future__ import annotations

from datetime import datetime, timezone

from ..models import Analysis, CheckIn, Profile, Reaction, RoutineEvent, RoutineItem


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def analysis_out(a: Analysis, include_raw: bool = False) -> dict:
    d = {
        "id": a.id,
        "created_at": iso(a.created_at),
        "source": a.source,
        "mode": a.mode,
        "api_version": a.api_version,
        "overall_score": a.overall_score,
        "skin_age": a.skin_age,
        "metrics": a.metrics,
        "unmapped_fields": a.unmapped_fields,
        "image_meta": a.image_meta,
        "capture_conditions": a.capture_conditions,
        "note": a.note,
        "is_demo": a.is_demo,
    }
    if include_raw:
        d["raw_response_redacted"] = a.raw_response_redacted
    return d


def reaction_out(r: Reaction) -> dict:
    return {"id": r.id, "created_at": iso(r.created_at), "description": r.description, "severity": r.severity, "is_demo": r.is_demo}


def item_out(i: RoutineItem) -> dict:
    return {
        "id": i.id,
        "name": i.name,
        "brand": i.brand,
        "category": i.category,
        "slot": i.slot,
        "step_order": i.step_order,
        "actives": i.actives,
        "ingredients_verified": i.ingredients_verified,
        "frequency": i.frequency,
        "introduced_on": i.introduced_on.isoformat() if i.introduced_on else None,
        "instructions": i.instructions,
        "paused": i.paused,
        "notes": i.notes,
        "library_product_id": i.library_product_id,
        "created_at": iso(i.created_at),
        "updated_at": iso(i.updated_at),
        "is_demo": i.is_demo,
        "reactions": [reaction_out(r) for r in i.reactions],
    }


def event_out(e: RoutineEvent) -> dict:
    return {"id": e.id, "created_at": iso(e.created_at), "item_id": e.item_id, "item_name": e.item_name, "kind": e.kind, "detail": e.detail, "is_demo": e.is_demo}


def checkin_out(c: CheckIn) -> dict:
    return {
        "id": c.id,
        "created_at": iso(c.created_at),
        "symptoms": c.symptoms,
        "red_flags": c.red_flags,
        "suspected_item_ids": c.suspected_item_ids,
        "confounders": c.confounders,
        "notes": c.notes,
        "is_demo": c.is_demo,
    }


def profile_out(p: Profile) -> dict:
    return {
        "display_name": p.display_name,
        "skin_goals": p.skin_goals,
        "budget_max": p.budget_max,
        "currency": p.currency,
        "avoid_fragrance": p.avoid_fragrance,
        "analysis_consent": p.analysis_consent,
        "analysis_consent_at": iso(p.analysis_consent_at),
        "consent_version": p.consent_version,
        "checkin_interval_days": p.checkin_interval_days,
    }
