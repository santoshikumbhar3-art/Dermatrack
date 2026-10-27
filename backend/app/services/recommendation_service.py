"""Explainable product matching.

Every match lists the reasons it was ranked where it was, the checks it
passed or failed, and the information we are missing. The engine makes no
efficacy claims: an "attribute match" only means the product is marketed for
that purpose, not that it will change a measurement.

The first recommendation is often *not to buy anything*: when the routine
already has several actives, open compatibility findings, or a reported
reaction, the matcher says so and only considers basic gaps (cleanser,
moisturiser, sunscreen).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Analysis, LibraryProduct, Profile, RoutineItem
from .adaptive_guidance import build_guidance
from .ingredient_rules import IRRITATING_ACTIVES, build_product, evaluate

ESSENTIALS = ["cleanser", "moisturiser", "sunscreen"]

# YouCam metric -> product attribute tags. Deliberately conservative.
METRIC_TO_TAGS = {
    "acne": ["blemish"],
    "pore": ["pore"],
    "oiliness": ["oil-control"],
    "moisture": ["hydration", "barrier-support"],
    "texture": ["texture"],
    "wrinkle": ["lines"],
    "radiance": ["radiance", "tone"],
    "age_spot": ["tone"],
}
NO_PRODUCT_MATCH = {
    "redness": "Redness can have many causes; DermaTrack doesn't match products to it. If it persists, a dermatologist can help.",
    "dark_circle": "Dark circles and eye-area measurements aren't matched to products here.",
    "eye_bag": "Eye-area measurements aren't matched to products here.",
    "firmness": "Firmness isn't matched to products here.",
    "droopy_upper_eyelid": "Eyelid measurements aren't matched to products here.",
    "droopy_lower_eyelid": "Eyelid measurements aren't matched to products here.",
    "tear_trough": "Tear-trough measurements aren't matched to products here.",
}
GOAL_TO_TAGS = {
    "hydration": ["hydration"],
    "breakouts": ["blemish"],
    "oil-control": ["oil-control"],
    "even-tone": ["tone"],
    "texture": ["texture"],
    "fine-lines": ["lines"],
    "sun-protection": ["sun-protection"],
    "simplify": [],
}
DEFAULT_SLOT = {"sunscreen": "am", "treatment": "pm", "exfoliant": "pm"}


def _routine_products(items: list[RoutineItem]):
    return [
        build_product(i.id, i.name, i.slot, i.frequency, i.instructions, i.actives, i.ingredients_verified, i.paused)
        for i in items
    ]


def recommend(db: Session, category: str | None = None) -> dict:
    profile = db.get(Profile, 1)
    items = list(db.scalars(select(RoutineItem)))
    active_items = [i for i in items if not i.paused]
    library = list(db.scalars(select(LibraryProduct)))
    latest_scan = db.scalar(select(Analysis).order_by(Analysis.created_at.desc()).limit(1))

    routine_eval = evaluate(_routine_products(items))
    guidance = build_guidance(db)

    routine_cats = {i.category for i in active_items}
    gaps = [c for c in ESSENTIALS if c not in routine_cats]
    routine_products = _routine_products(active_items)
    routine_families = set().union(*(p.families() for p in routine_products)) if routine_products else set()
    n_actives = sum(1 for p in routine_products if p.families() & IRRITATING_ACTIVES)

    # ---- simplify-first gate
    simplify_reasons = []
    if guidance["safety_active"]:
        simplify_reasons.append("You've reported a significant reaction. Adding products now would make it harder to recover and to understand the cause.")
    if any(c["level"] == "caution" for c in guidance["cards"]):
        simplify_reasons.append("There's an open caution in your guidance (for example, recent irritation).")
    if routine_eval["counts"]["documented_concern"] or routine_eval["counts"]["precaution"]:
        simplify_reasons.append("Your current routine already has compatibility findings to resolve.")
    if n_actives >= 3:
        simplify_reasons.append(f"Your routine already includes {n_actives} products with irritating actives.")
    simplify = bool(simplify_reasons)

    # ---- focus areas
    focus_tags: dict[str, str] = {}
    focus_notes: list[str] = []
    if latest_scan:
        whole = [m for m in latest_scan.metrics or [] if m.get("region") in (None, "whole") and m.get("raw_score") is not None]
        lowest = sorted(whole, key=lambda m: m["raw_score"])[:3]
        for m in lowest:
            tags = METRIC_TO_TAGS.get(m["canonical"])
            if tags:
                for t in tags:
                    focus_tags.setdefault(t, f"{m['label']} was one of your lowest AI measurements (raw {m['raw_score']:.0f}) in scan #{latest_scan.id}")
            elif m["canonical"] in NO_PRODUCT_MATCH:
                focus_notes.append(NO_PRODUCT_MATCH[m["canonical"]])
    goals = (profile.skin_goals if profile else []) or []
    for g in goals:
        for t in GOAL_TO_TAGS.get(g, []):
            focus_tags.setdefault(t, f"Matches your goal: {g.replace('-', ' ')}")

    owned_keys = {(i.name.lower(), i.brand.lower()) for i in items} | {i.library_product_id for i in items if i.library_product_id}
    budget = profile.budget_max if profile else None
    avoid_frag = profile.avoid_fragrance if profile else False

    matches, excluded = [], []
    for lp in library:
        if category and lp.category != category:
            continue
        if lp.id in owned_keys or (lp.name.lower(), lp.brand.lower()) in owned_keys:
            continue
        reasons, checks, missing = [], [], []
        score = 0.0
        cand = build_product(f"lib-{lp.id}", f"{lp.brand} {lp.name}", DEFAULT_SLOT.get(lp.category, "both"), "daily", lp.instructions, lp.key_actives, lp.ingredients_verified)
        cand_fams = cand.families()
        is_active = bool(cand_fams & IRRITATING_ACTIVES)

        if simplify and lp.category not in gaps:
            excluded.append({"id": lp.id, "name": f"{lp.brand} {lp.name}", "reason": "Held back while your routine is simplified."})
            continue

        if lp.category in gaps:
            score += 3
            reasons.append(f"Fills a gap: no {lp.category} is recorded in your routine.")
        tag_hits = [t for t in lp.attributes if t in focus_tags]
        for t in tag_hits:
            score += 2
            reasons.append(f"Marketed for '{t}'. {focus_tags[t]}.")

        # Compatibility with the current routine
        combined = evaluate(routine_products + [cand])
        new_findings = [f for f in combined["findings"] if cand.id in f["product_ids"] and f["severity"] in ("documented_concern", "precaution")]
        if new_findings:
            score -= 3 * len(new_findings)
            for f in new_findings:
                checks.append({"ok": False, "label": f"{f['title']} (with {', '.join(n for n in f['product_names'] if n != cand.name)})", "rule_id": f["rule_id"]})
        else:
            checks.append({"ok": True, "label": "No compatibility rule flagged with your current routine"})

        dup = (cand_fams & routine_families) & (IRRITATING_ACTIVES | {"niacinamide"})
        if dup:
            score -= 2
            checks.append({"ok": False, "label": "You already use a product with " + ", ".join(sorted(dup)).replace("_", " ")})

        # Budget
        if lp.price is None:
            missing.append("Price not verified — budget filter not applied.")
        elif budget is not None and lp.price > budget:
            excluded.append({"id": lp.id, "name": f"{lp.brand} {lp.name}", "reason": f"Above your budget ({lp.price:.0f} {lp.currency})."})
            continue
        elif budget is not None:
            checks.append({"ok": True, "label": f"Within your budget ({lp.price:.0f} {lp.currency}, user-verified)"})

        # Fragrance preference
        if avoid_frag:
            if lp.fragrance_free is False:
                excluded.append({"id": lp.id, "name": f"{lp.brand} {lp.name}", "reason": "Contains fragrance."})
                continue
            if lp.fragrance_free is None:
                missing.append("Fragrance-free status not verified.")
            else:
                checks.append({"ok": True, "label": "Marketed as fragrance-free"})
        if not lp.ingredients_verified:
            missing.append("Full ingredient list not verified; only named key actives were checked.")
        if is_active:
            missing.append("Introduce actives one at a time and patch test first.")

        if score <= 0 and not reasons:
            continue
        matches.append(
            {
                "product": _lp_dict(lp),
                "score": round(score, 1),
                "reasons": reasons,
                "checks": checks,
                "missing_information": missing,
            }
        )

    matches.sort(key=lambda m: m["score"], reverse=True)
    headline = (
        "Before buying anything: simplify." if simplify
        else ("Your routine covers the basics. Nothing here is necessary — these are optional." if not gaps else f"Your routine is missing: {', '.join(gaps)}.")
    )
    return {
        "headline": headline,
        "simplify_first": simplify,
        "simplify_reasons": simplify_reasons,
        "gaps": gaps,
        "focus": [{"tag": k, "why": v} for k, v in focus_tags.items()],
        "focus_notes": sorted(set(focus_notes)),
        "based_on_scan": {"id": latest_scan.id, "source": latest_scan.source} if latest_scan else None,
        "matches": matches[:8],
        "excluded": excluded,
        "method": "Score = +3 fills an essential gap, +2 per attribute matching a focus area, −3 per compatibility finding with your routine, −2 if it duplicates an active you already use. Matching uses marketing attributes, not proven results.",
    }


def _lp_dict(lp: LibraryProduct) -> dict:
    return {
        "id": lp.id,
        "name": lp.name,
        "brand": lp.brand,
        "category": lp.category,
        "key_actives": lp.key_actives,
        "full_ingredients": lp.full_ingredients,
        "ingredients_verified": lp.ingredients_verified,
        "attributes": lp.attributes,
        "fragrance_free": lp.fragrance_free,
        "price": lp.price,
        "currency": lp.currency,
        "price_source": lp.price_source,
        "instructions": lp.instructions,
        "source": lp.source,
        "limitations": lp.limitations,
        "user_added": lp.user_added,
    }
