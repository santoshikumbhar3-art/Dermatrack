"""Adaptive Guidance Engine.

Deterministic, explainable rules that connect:
  * user-reported symptoms and warning signs (check-ins, product reactions),
  * routine history (what was introduced when),
  * AI scan comparisons.

Safety rules run first and are *locked*: when a safety rule fires, no other
card may suggest continuing an active, and reassuring scan results are
explicitly prevented from counting as evidence that it is safe to continue.
An optional language model may rephrase cards elsewhere, but cannot remove or
alter a locked card (see assistant_service).

Nothing here diagnoses a condition, and no card claims a product *caused* a
change. Temporal associations are described as possible and unproven.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Analysis, CheckIn, Profile, RoutineItem
from .ingredient_rules import IRRITATING_ACTIVES, build_product
from .progress_service import _as_utc, compare, comparability_key, primary_group_key

SYMPTOM_LABELS = {
    "irritation": "irritation",
    "redness": "redness",
    "dryness": "dryness",
    "burning": "burning or stinging",
    "itching": "itching",
    "peeling": "peeling",
    "breakouts": "breakouts",
    "swelling": "swelling",
    "discomfort": "discomfort",
}

RED_FLAG_LABELS = {
    "difficulty_breathing": "difficulty breathing or swallowing",
    "face_lip_tongue_swelling": "swelling of the face, lips or tongue",
    "blistering": "blistering",
    "oozing_or_crusting": "oozing or crusting",
    "spreading_rash": "a rash that is spreading",
    "eye_pain_or_swelling": "eye pain, swelling or vision changes",
    "fever": "fever with a skin reaction",
}
EMERGENCY_FLAGS = {"difficulty_breathing", "face_lip_tongue_swelling"}

IRRITATION_SYMPTOMS = {"irritation", "redness", "burning", "itching", "peeling", "dryness", "swelling", "discomfort"}
RECENT_WINDOW_DAYS = 21


def _card(cid: str, level: str, title: str, **kw) -> dict:
    return {
        "id": cid,
        "level": level,  # urgent | caution | info | ok
        "title": title,
        "observed": kw.get("observed", []),
        "reasoning": kw.get("reasoning", ""),
        "suggestions": kw.get("suggestions", []),
        "questions": kw.get("questions", []),
        "records": kw.get("records", []),
        "safety_locked": kw.get("safety_locked", False),
    }


def _is_active_product(item: RoutineItem) -> bool:
    p = build_product(item.id, item.name, item.slot, item.frequency, item.instructions, item.actives, item.ingredients_verified)
    return bool(p.families() & IRRITATING_ACTIVES)


def build_guidance(db: Session, today: date | None = None) -> dict:
    today = today or datetime.now(timezone.utc).date()
    profile = db.get(Profile, 1)
    checkins = list(db.scalars(select(CheckIn).order_by(CheckIn.created_at.desc())))
    items = list(db.scalars(select(RoutineItem)))
    scans = list(db.scalars(select(Analysis).order_by(Analysis.created_at)))

    cards: list[dict] = []
    latest = checkins[0] if checkins else None
    latest_recent = latest and (today - _as_utc(latest.created_at).date()).days <= 7

    recent_items = [
        i for i in items
        if i.introduced_on and 0 <= (today - i.introduced_on).days <= RECENT_WINDOW_DAYS and not i.paused
    ]
    recent_active_items = [i for i in recent_items if _is_active_product(i)]

    # ------------------------------------------------------------- SAFETY (locked)
    safety_fired = False
    if latest and latest_recent:
        flags = set(latest.red_flags or [])
        sym = latest.symptoms or {}
        severe = {k for k, v in sym.items() if isinstance(v, int) and v >= 3 and k in ("burning", "swelling", "irritation", "redness", "discomfort", "itching")}
        rec = [{"type": "checkin", "id": latest.id, "label": f"Check-in {_as_utc(latest.created_at).date().isoformat()}"}]
        if flags & EMERGENCY_FLAGS:
            safety_fired = True
            cards.append(
                _card(
                    "G-SAFE-EMERGENCY",
                    "urgent",
                    "Get urgent medical help now",
                    observed=[f"You reported {RED_FLAG_LABELS[f]}." for f in sorted(flags & EMERGENCY_FLAGS)],
                    reasoning=(
                        "These can be signs of a serious allergic reaction. DermaTrack cannot assess this and "
                        "will not offer skincare suggestions until it has been addressed."
                    ),
                    suggestions=[
                        "Contact your local emergency number (112 in India) or go to the nearest emergency department now.",
                        "Do not apply any more skincare products.",
                    ],
                    records=rec,
                    safety_locked=True,
                )
            )
        elif flags or severe:
            safety_fired = True
            obs = [f"You reported {RED_FLAG_LABELS.get(f, f)}." for f in sorted(flags)]
            obs += [f"You rated {SYMPTOM_LABELS.get(s, s)} as severe (3/3)." for s in sorted(severe)]
            suspects = [i for i in items if i.id in (latest.suspected_item_ids or [])] or recent_active_items
            sugg = [
                "Stop using new or active products for now"
                + (f" — especially {', '.join(i.name for i in suspects)}" if suspects else "")
                + ".",
                "Gently rinse off any product still on the skin with lukewarm water.",
                "Contact a doctor or dermatologist promptly. If symptoms worsen quickly, seek urgent care.",
                "A skin scan cannot tell whether a reaction is safe to continue through. Please don't use scan results to decide this.",
            ]
            cards.append(
                _card(
                    "G-SAFE-SEVERE",
                    "urgent",
                    "This reaction needs a professional to look at it",
                    observed=obs,
                    reasoning=(
                        "Severe burning, swelling, blistering and similar signs are outside what an app should "
                        "interpret. DermaTrack does not try to identify the cause or diagnose the reaction."
                    ),
                    suggestions=sugg,
                    records=rec + [{"type": "routine_item", "id": i.id, "label": i.name} for i in suspects],
                    safety_locked=True,
                )
            )

    # Severe product-level reactions recorded in the routine also lock safety.
    for i in items:
        for r in i.reactions:
            if r.severity >= 3 and (today - _as_utc(r.created_at).date()).days <= 14 and not i.paused:
                safety_fired = True
                cards.append(
                    _card(
                        f"G-SAFE-REACTION-{i.id}",
                        "urgent",
                        f"Severe reaction recorded for {i.name}",
                        observed=[f"On {_as_utc(r.created_at).date().isoformat()} you recorded: “{r.description}” (severe)."],
                        reasoning="A severe reaction is recorded and the product is still active in your routine.",
                        suggestions=[
                            f"Pause {i.name} (you can do this from My Routine).",
                            "Seek advice from a doctor, dermatologist or pharmacist before using it again.",
                        ],
                        records=[{"type": "routine_item", "id": i.id, "label": i.name}],
                        safety_locked=True,
                    )
                )

    # ------------------------------------------------------- IRRITATION (caution)
    if latest and latest_recent and not safety_fired:
        sym = latest.symptoms or {}
        moderate = {k: v for k, v in sym.items() if k in IRRITATION_SYMPTOMS and isinstance(v, int) and v >= 2}
        mild = {k: v for k, v in sym.items() if k in IRRITATION_SYMPTOMS and isinstance(v, int) and v == 1}
        rec = [{"type": "checkin", "id": latest.id, "label": f"Check-in {_as_utc(latest.created_at).date().isoformat()}"}]
        if moderate:
            obs = [f"You rated {SYMPTOM_LABELS[k]} {v}/3." for k, v in moderate.items()]
            if recent_active_items:
                for i in recent_active_items:
                    obs.append(f"{i.name} was introduced on {i.introduced_on.isoformat()} ({(today - i.introduced_on).days} days ago).")
                cards.append(
                    _card(
                        "G-IRRITATION-NEW-ACTIVE",
                        "caution",
                        "Irritation reported after a new active product",
                        observed=obs,
                        reasoning=(
                            "The timing fits, so a link is possible, but it is not proven: weather, other products, "
                            "stress and many other things can cause irritation too."
                        ),
                        suggestions=[
                            "Re-read the product instructions (frequency, amount, whether to build up gradually).",
                            "Don't add any new actives or increase how often you use this one for now.",
                            "Consider pausing the most recently introduced active until your skin settles.",
                            "If irritation continues for more than about a week, or gets worse, ask a pharmacist, doctor or dermatologist.",
                        ],
                        questions=[] if latest.suspected_item_ids else ["Is there one product you suspect? You can mark it in your next check-in."],
                        records=rec + [{"type": "routine_item", "id": i.id, "label": i.name} for i in recent_active_items],
                    )
                )
            else:
                cards.append(
                    _card(
                        "G-IRRITATION-NO-NEW",
                        "caution",
                        "Irritation reported",
                        observed=obs,
                        reasoning="No product with an irritating active was recorded as introduced in the last three weeks, so the routine history doesn't point to a likely trigger.",
                        suggestions=[
                            "Avoid adding new products while your skin settles.",
                            "If it persists or worsens, check with a pharmacist, doctor or dermatologist.",
                        ],
                        questions=[
                            "Did anything else change recently — a new product not yet in My Routine, weather, travel, or how often you use something?"
                        ],
                        records=rec,
                    )
                )
        elif mild:
            cards.append(
                _card(
                    "G-MILD",
                    "info",
                    "Mild symptoms — keep an eye on them",
                    observed=[f"You rated {SYMPTOM_LABELS[k]} 1/3." for k in mild],
                    reasoning="Mild, short-lived dryness or tingling is common when starting some actives, but it's worth tracking.",
                    suggestions=["Avoid increasing frequency or adding new actives until the next check-in."],
                    records=rec,
                )
            )

    # Moderate product reactions
    if not safety_fired:
        for i in items:
            mod = [r for r in i.reactions if r.severity == 2 and (today - _as_utc(r.created_at).date()).days <= 14]
            if mod and not i.paused:
                cards.append(
                    _card(
                        f"G-REACTION-{i.id}",
                        "caution",
                        f"Reaction recorded for {i.name}",
                        observed=[f"{_as_utc(r.created_at).date().isoformat()}: “{r.description}” (moderate)" for r in mod],
                        reasoning="You linked this reaction to this product yourself; DermaTrack has not verified the cause.",
                        suggestions=[f"Consider pausing {i.name} and reviewing its instructions.", "Seek professional advice if it doesn't settle."],
                        records=[{"type": "routine_item", "id": i.id, "label": i.name}],
                    )
                )

    # ---------------------------------------------------------------- SCANS
    if scans:
        pk = primary_group_key(scans)
        group = [s for s in scans if comparability_key(s) == pk]
        latest_scan = group[-1]
        if len(group) == 1:
            cards.append(
                _card(
                    "G-ONE-SCAN",
                    "info",
                    "Your baseline is set",
                    observed=[f"One comparable scan on {_as_utc(latest_scan.created_at).date().isoformat()}."],
                    reasoning="A single scan can't show change over time.",
                    suggestions=["Scan again in about a week, in the same place, light and distance, without makeup."],
                    records=[{"type": "scan", "id": latest_scan.id, "label": f"Scan #{latest_scan.id}"}],
                )
            )
        else:
            prev = group[-2]
            cmp = compare(prev, latest_scan)
            moved = [r for r in cmp["metrics"] if r["status"] != "no_clear_change"]
            between = [
                i for i in items
                if i.introduced_on and _as_utc(prev.created_at).date() <= i.introduced_on <= _as_utc(latest_scan.created_at).date()
            ]
            recs = [
                {"type": "scan", "id": prev.id, "label": f"Scan #{prev.id}"},
                {"type": "scan", "id": latest_scan.id, "label": f"Scan #{latest_scan.id}"},
            ]
            lock_note = (
                ["Because you reported a significant reaction, these scan results should not be used to decide whether to keep using a product."]
                if safety_fired
                else []
            )
            if not moved:
                cards.append(
                    _card(
                        "G-SCAN-NO-CHANGE",
                        "ok",
                        "No clear change between your last two scans",
                        observed=[f"All shared measurements moved by less than {cmp['noise_band_points']:.0f} points."] + cmp["condition_differences"],
                        reasoning="The available data does not show a clear change. That is common over short periods and isn't a reason to buy something new.",
                        suggestions=lock_note
                        + [
                            "Keep your routine consistent so future comparisons are meaningful.",
                            "Scan in the same lighting, distance and time of day, without makeup.",
                        ],
                        records=recs,
                    )
                )
            else:
                redness_worse = next((r for r in moved if r["canonical"] == "redness" and r["delta_points"] < 0), None)
                obs = [f"{r['label']}: {r['delta_points']:+.1f} points ({'more' if r['delta_points'] > 0 else 'less'} favourable AI measurement)" for r in moved]
                if between:
                    obs += [f"{i.name} was introduced on {i.introduced_on.isoformat()}, between these scans." for i in between]
                    cards.append(
                        _card(
                            "G-SCAN-CHANGE-AFTER-PRODUCT",
                            "caution" if redness_worse else "info",
                            "Scan changed after a routine change",
                            observed=obs + cmp["condition_differences"],
                            reasoning=(
                                "These happened in the same period. That's a temporal association only — it doesn't show "
                                "the product caused the change. Photo conditions, season and other factors can also shift AI measurements."
                            ),
                            suggestions=lock_note
                            + (
                                ["The redness measurement moved in the less favourable direction. If you also see or feel more redness, consider pausing the new product and reviewing its instructions."]
                                if redness_worse
                                else []
                            )
                            + ["Add a check-in describing how your skin feels so the measurements have context."],
                            questions=["Were these two scans taken in similar lighting and without makeup?", "Did anything else change — weather, sleep, other products?"],
                            records=recs + [{"type": "routine_item", "id": i.id, "label": i.name} for i in between],
                        )
                    )
                else:
                    cards.append(
                        _card(
                            "G-SCAN-CHANGE",
                            "info",
                            "Some measurements changed between your last two scans",
                            observed=obs + cmp["condition_differences"],
                            reasoning="No routine change was recorded between these scans, so there's no routine event to relate this to.",
                            suggestions=lock_note + ["Keep scanning under consistent conditions to see whether the change holds."],
                            records=recs,
                        )
                    )

    # ------------------------------------------------------------ CHECK-IN DUE
    interval = (profile.checkin_interval_days if profile else 7) or 7
    last_touch = max(
        [_as_utc(c.created_at).date() for c in checkins[:1]] + [_as_utc(s.created_at).date() for s in scans[-1:]],
        default=None,
    )
    next_due = (last_touch + timedelta(days=interval)) if last_touch else today
    if not scans and not checkins and not items:
        cards.append(
            _card(
                "G-START",
                "info",
                "Start with a baseline scan",
                reasoning="There's no data yet, so DermaTrack has nothing to compare.",
                suggestions=["Complete your first skin scan, then add the products you currently use."],
            )
        )

    order = {"urgent": 0, "caution": 1, "info": 2, "ok": 3}
    cards.sort(key=lambda c: order[c["level"]])
    return {
        "cards": cards,
        "safety_active": safety_fired,
        "next_checkin_due": next_due.isoformat(),
        "checkin_interval_days": interval,
        "disclaimer": "Guidance is rule-based and informational. It is not a diagnosis or medical advice.",
    }
