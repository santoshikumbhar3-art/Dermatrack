"""AI Skin Companion.

Two modes, reported honestly to the UI:

* ``rule_based`` (default): intent matching over the user's stored records.
  This is a deterministic assistant, not an agentic AI. Every answer is built
  from database records and lists those records as citations.
* ``llm_phrased``: when ANTHROPIC_API_KEY is configured, the *same* grounded
  facts and citations are produced first, and a language model is asked only
  to rephrase them conversationally. It is instructed not to add facts. Safety
  text from locked guidance cards is appended verbatim after the model's text
  and cannot be altered by it. If the model call fails, the rule-based answer
  is returned and the response says so.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Analysis, CheckIn, RoutineEvent, RoutineItem
from .adaptive_guidance import RED_FLAG_LABELS, SYMPTOM_LABELS, build_guidance
from .ingredient_rules import DISPLAY, FAMILY_LABEL, build_product, evaluate, resolve
from .progress_service import _as_utc, build_progress, compare, comparability_key, primary_group_key

log = logging.getLogger("dermatrack.assistant")

EMERGENCY_PAT = re.compile(
    r"(can'?t breathe|cannot breathe|trouble breathing|difficulty breathing|throat (is )?(closing|swelling)|"
    r"(lip|lips|tongue|face|eye|eyes) (is |are )?(swelling|swollen)|anaphyla)",
    re.I,
)
SEVERE_PAT = re.compile(r"(blister|oozing|severe(ly)? (burn|pain|itch)|really bad(ly)? burn|spreading rash|chemical burn)", re.I)
DIAGNOSE_PAT = re.compile(r"(do i have|diagnos|is (this|it) (rosacea|eczema|dermatitis|psoriasis|melasma|cancer|melanoma|an infection|fungal))", re.I)

INTENTS = [
    ("what_changed", re.compile(r"(chang|differen|compare|since (my )?last|between (my )?scans)", re.I)),
    ("trend", re.compile(r"(trend|consistent|improv|getting (better|worse)|progress|working)", re.I)),
    ("why_flagged", re.compile(r"(flag|conflict|combin|compatib|mix|together|warning|interact|why)", re.I)),
    ("recent_products", re.compile(r"(add(ed)?|recent|new product|introduc|start(ed)? using)", re.I)),
    ("missing_info", re.compile(r"(missing|incomplete|what (info|information|data)|unknown|fill in)", re.I)),
    ("next_checkin", re.compile(r"(check.?in|when should|next scan|scan again|how often)", re.I)),
    ("symptoms", re.compile(r"(reaction|irritat|symptom|felt|feel|redness|dry|burn|itch)", re.I)),
    ("latest_scan", re.compile(r"(latest scan|last scan|my scan|my score|results?)", re.I)),
]

CAPABILITIES = [
    "What changed since my last scan?",
    "Which products did I add recently?",
    "Why was this combination flagged?",
    "What information is missing from my routine?",
    "When should I check in again?",
    "Does my data show a consistent trend?",
]


def _cite(kind: str, id_, label: str) -> dict:
    return {"type": kind, "id": id_, "label": label}


def _d(dt: datetime) -> str:
    return _as_utc(dt).strftime("%d %b %Y")


def classify(message: str) -> str:
    if EMERGENCY_PAT.search(message):
        return "emergency"
    if SEVERE_PAT.search(message):
        return "severe"
    if DIAGNOSE_PAT.search(message):
        return "diagnosis_request"
    for name, pat in INTENTS:
        if pat.search(message):
            return name
    return "help"


def _answer_rules(db: Session, message: str, intent: str) -> dict:
    cites: list[dict] = []
    measured: list[str] = []
    reported: list[str] = []
    text = ""
    insufficient = False

    scans = list(db.scalars(select(Analysis).order_by(Analysis.created_at)))
    items = list(db.scalars(select(RoutineItem)))

    if intent == "emergency":
        text = (
            "What you're describing — trouble breathing or swelling of the face, lips, tongue or throat — can be a "
            "serious allergic reaction. Please call your local emergency number (112 in India) or go to the nearest "
            "emergency department now. Don't apply any more products. I can't assess this."
        )
        return {"text": text, "citations": [], "measured": [], "reported": [], "insufficient": False, "safety": True}

    if intent == "severe":
        text = (
            "That sounds like more than ordinary irritation, and I can't assess it or say what's causing it. Please stop "
            "using new or active products, gently rinse off anything still on your skin, and contact a doctor or "
            "dermatologist promptly — sooner if it's getting worse. A skin scan can't tell you whether it's safe to keep "
            "going. You can also log this in a check-in so it's recorded."
        )
        return {"text": text, "citations": [], "measured": [], "reported": [], "insufficient": False, "safety": True}

    if intent == "diagnosis_request":
        text = (
            "I can't diagnose skin conditions — and the YouCam scan measures how features appear in a photo; it isn't a "
            "medical test. A dermatologist can examine your skin properly. What I can do is summarise your scan "
            "measurements, check-ins and routine changes so you have a clear record to take to that appointment."
        )
        return {"text": text, "citations": [], "measured": [], "reported": [], "insufficient": False, "safety": False}

    if intent in ("what_changed", "latest_scan"):
        if not scans:
            text, insufficient = "You don't have any scans yet, so there's nothing to compare. Start with a baseline scan in Skin Analysis.", True
        else:
            pk = primary_group_key(scans)
            group = [s for s in scans if comparability_key(s) == pk]
            latest = group[-1]
            cites.append(_cite("scan", latest.id, f"Scan #{latest.id} · {_d(latest.created_at)}"))
            if intent == "latest_scan" or len(group) < 2:
                whole = [m for m in latest.metrics if m.get("region") in (None, "whole")]
                low = sorted(whole, key=lambda m: m["raw_score"] or 0)[:3]
                measured.append(f"Latest scan ({_d(latest.created_at)}): overall {latest.overall_score:.0f}" if latest.overall_score is not None else f"Latest scan ({_d(latest.created_at)})")
                measured += [f"{m['label']}: raw {m['raw_score']:.1f} (display {m['ui_score']})" for m in low]
                text = "Here are the lowest AI measurements from your latest scan (higher is more favourable on YouCam's 1–100 scale)."
                if len(group) < 2 and intent == "what_changed":
                    text = "You only have one comparable scan, so I can't say what changed yet. " + text
                    insufficient = True
            else:
                prev = group[-2]
                cites.insert(0, _cite("scan", prev.id, f"Scan #{prev.id} · {_d(prev.created_at)}"))
                cmp = compare(prev, latest)
                moved = [r for r in cmp["metrics"] if r["status"] != "no_clear_change"]
                for r in cmp["metrics"]:
                    tag = {"more_favourable": "more favourable", "less_favourable": "less favourable", "no_clear_change": "no clear change"}[r["status"]]
                    measured.append(f"{r['label']}: {r['baseline_raw']:.1f} → {r['current_raw']:.1f} ({r['delta_points']:+.1f}, {tag})")
                text = (
                    f"Between {_d(prev.created_at)} and {_d(latest.created_at)}, "
                    + (f"{len(moved)} measurement{'s' if len(moved) != 1 else ''} moved by more than {cmp['noise_band_points']:.0f} points." if moved else "no measurement moved beyond the variation band, so there's no clear change.")
                    + " These are changes in AI photo measurements, not proof of a change in your skin's health."
                )
                if cmp["condition_differences"]:
                    text += " Note: " + " ".join(cmp["condition_differences"])
                events = list(db.scalars(select(RoutineEvent).where(RoutineEvent.created_at >= prev.created_at, RoutineEvent.created_at <= latest.created_at)))
                for e in events:
                    cites.append(_cite("routine_event", e.id, f"{e.kind}: {e.item_name}"))
                if events:
                    text += f" {len(events)} routine change{'s' if len(events) != 1 else ''} happened in between; that's a timing overlap, not evidence of cause."

    elif intent == "trend":
        prog = build_progress(db)
        n = prog["comparable_scan_count"]
        if n < 2:
            text, insufficient = "There isn't enough data for a trend — you need at least two comparable scans, and three or more is better.", True
        else:
            consistent = []
            for s in prog["series"]:
                pts = [p["raw"] for p in s["points"]]
                if len(pts) >= 3:
                    diffs = [b - a for a, b in zip(pts, pts[1:])]
                    if all(d >= 0 for d in diffs) and pts[-1] - pts[0] >= 3:
                        consistent.append(f"{s['label']}: steadily more favourable ({pts[0]:.1f} → {pts[-1]:.1f})")
                    elif all(d <= 0 for d in diffs) and pts[0] - pts[-1] >= 3:
                        consistent.append(f"{s['label']}: steadily less favourable ({pts[0]:.1f} → {pts[-1]:.1f})")
            measured += consistent
            if n < 3:
                text = "With only two comparable scans I can show a difference, but not a consistent trend. " + prog["summary"]["headline"]
                insufficient = True
            elif consistent:
                text = f"Across {n} comparable scans, {len(consistent)} measurement{'s' if len(consistent) != 1 else ''} moved in one direction every time. The rest went up and down, which is common with photo-based measurements."
            else:
                text = f"Across {n} comparable scans, no measurement moved consistently in one direction by more than 3 points."
            for p in prog["overall"]:
                cites.append(_cite("scan", p["analysis_id"], f"Scan #{p['analysis_id']}"))

    elif intent == "why_flagged":
        result = evaluate([build_product(i.id, i.name, i.slot, i.frequency, i.instructions, i.actives, i.ingredients_verified, i.paused) for i in items])
        findings = result["findings"]
        # Optional filter by an ingredient or product named in the question.
        msg = message.lower()
        named_items = [i for i in items if i.name.lower() in msg or (i.brand and i.brand.lower() in msg)]
        named_fams = set()
        for word in re.findall(r"[a-z][a-z \-]{2,}", msg):
            c, f = resolve(word)
            if f:
                named_fams.add(f)
        if named_items:
            findings = [f for f in findings if any(i.id in f["product_ids"] for i in named_items)] or findings
        if not findings:
            text = "Nothing is flagged in your current routine." if items else "Your routine is empty, so there's nothing to check yet."
            insufficient = not items
        else:
            serious = [f for f in findings if f["severity"] in ("documented_concern", "precaution")]
            show = serious or findings
            lines = []
            for f in show[:4]:
                lines.append(f"**{f['title']}** ({f['severity'].replace('_', ' ')}, rule {f['rule_id']}) — {', '.join(f['product_names'])}. {f['explanation']} Next step: {f['next_step']}")
                if f.get("frequency_note"):
                    lines.append(f"  {f['frequency_note']}")
                cites.append(_cite("rule", f["rule_id"], f["rule_id"]))
                for pid, pn in zip(f["product_ids"], f["product_names"]):
                    cites.append(_cite("routine_item", pid, pn))
            text = "Here's why, from the rules engine:\n" + "\n".join(f"- {l}" for l in lines)
            if named_fams and not named_items:
                text += "\n\n(I matched on " + ", ".join(FAMILY_LABEL.get(f, f) for f in sorted(named_fams)) + ".)"

    elif intent == "recent_products":
        events = list(db.scalars(select(RoutineEvent).where(RoutineEvent.kind == "added").order_by(RoutineEvent.created_at.desc()).limit(6)))
        dated = sorted([i for i in items if i.introduced_on], key=lambda i: i.introduced_on, reverse=True)[:6]
        if not events and not dated:
            text, insufficient = "No products are recorded yet. Add them in My Routine and I can track when each one started.", True
        else:
            lines = []
            for i in dated:
                lines.append(f"{i.name}{' (' + i.brand + ')' if i.brand else ''} — introduced {i.introduced_on.strftime('%d %b %Y')}{', paused' if i.paused else ''}")
                cites.append(_cite("routine_item", i.id, i.name))
            for e in events:
                if not any(c["type"] == "routine_item" and c["id"] == e.item_id for c in cites):
                    lines.append(f"{e.item_name} — added to DermaTrack on {_d(e.created_at)} (no start date recorded)")
                    cites.append(_cite("routine_event", e.id, f"added: {e.item_name}"))
            text = "Most recent first:\n" + "\n".join(f"- {l}" for l in lines)

    elif intent == "missing_info":
        gaps = []
        for i in items:
            miss = []
            if not i.actives:
                miss.append("no active ingredients recorded")
            elif any(a.get("concentration_percent") in (None, "") for a in i.actives if resolve(a.get("name", ""))[1] in {"retinoid", "aha", "bha", "vitamin_c_laa", "benzoyl_peroxide"}):
                miss.append("concentration unknown for an active")
            if not i.introduced_on:
                miss.append("no start date")
            if not i.ingredients_verified:
                miss.append("ingredients not verified against the label")
            if miss:
                gaps.append(f"{i.name}: {', '.join(miss)}")
                cites.append(_cite("routine_item", i.id, i.name))
        cats = {i.category for i in items if not i.paused}
        for c in ("cleanser", "moisturiser", "sunscreen"):
            if c not in cats:
                gaps.append(f"No {c} recorded in your routine")
        if not items:
            text, insufficient = "Your routine is empty — add the products you use and I'll point out what's missing.", True
        elif gaps:
            text = "These gaps limit how well I can check your routine:\n" + "\n".join(f"- {g}" for g in gaps)
        else:
            text = "Your routine records look complete for the checks DermaTrack runs."

    elif intent == "next_checkin":
        g = build_guidance(db)
        due = datetime.fromisoformat(g["next_checkin_due"]).strftime("%d %b %Y")
        text = (
            f"Your next check-in is due around {due} (every {g['checkin_interval_days']} days, set in Settings). "
            "For scans, keep the same spot, light, distance and time of day, with no makeup, so comparisons are fair."
        )

    elif intent == "symptoms":
        recent = list(db.scalars(select(CheckIn).order_by(CheckIn.created_at.desc()).limit(5)))
        if not recent:
            text, insufficient = "You haven't logged any check-ins yet, so I have no reported symptoms to go on.", True
        else:
            for c in recent:
                parts = [f"{SYMPTOM_LABELS.get(k, k)} {v}/3" for k, v in (c.symptoms or {}).items() if v]
                parts += [RED_FLAG_LABELS.get(f, f) for f in (c.red_flags or [])]
                reported.append(f"{_d(c.created_at)}: {', '.join(parts) or 'nothing reported'}")
                cites.append(_cite("checkin", c.id, f"Check-in {_d(c.created_at)}"))
            for i in items:
                for r in i.reactions[-2:]:
                    reported.append(f"{_d(r.created_at)} — {i.name}: “{r.description}” (severity {r.severity}/3)")
                    cites.append(_cite("routine_item", i.id, i.name))
            text = "Here's what you've reported recently. These are your own observations, separate from the AI scan measurements."

    else:
        text = "I answer questions using your saved scans, check-ins and routine. Try one of these:\n" + "\n".join(f"- {c}" for c in CAPABILITIES)

    return {"text": text, "citations": _dedupe(cites), "measured": measured, "reported": reported, "insufficient": insufficient, "safety": False}


def _dedupe(c: list[dict]) -> list[dict]:
    seen, out = set(), []
    for x in c:
        k = (x["type"], str(x["id"]))
        if k not in seen:
            seen.add(k)
            out.append(x)
    return out


async def _llm_rephrase(message: str, grounded: dict) -> str | None:
    system = (
        "You rephrase a skincare-tracking app's grounded answer conversationally for the user. Use ONLY the facts "
        "in GROUNDED_ANSWER. Do not add facts, numbers, products, ingredients, diagnoses, or claims that a product "
        "caused a change. Keep 'measured' (AI scan) and 'reported' (user's own observations) clearly separate. If "
        "the data is insufficient, say so. Keep it under 150 words. Plain text, short paragraphs, '-' for lists."
    )
    body = {
        "model": settings.assistant_llm_model,
        "max_tokens": 400,
        "system": system,
        "messages": [
            {"role": "user", "content": f"USER_QUESTION: {message}\n\nGROUNDED_ANSWER (JSON): {json.dumps({k: grounded[k] for k in ('text', 'measured', 'reported', 'insufficient')})}"}
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": settings.anthropic_api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json=body,
            )
        if r.status_code != 200:
            log.warning("LLM rephrase failed with status %s", r.status_code)
            return None
        parts = r.json().get("content", [])
        return "".join(p.get("text", "") for p in parts if p.get("type") == "text").strip() or None
    except (httpx.HTTPError, ValueError):
        log.warning("LLM rephrase failed")
        return None


async def answer(db: Session, message: str) -> dict:
    intent = classify(message)
    grounded = _answer_rules(db, message, intent)

    # Locked safety cards from the guidance engine are always attached verbatim.
    guidance = build_guidance(db)
    safety_notes = [
        c["title"] + ": " + " ".join(c["suggestions"]) for c in guidance["cards"] if c["safety_locked"]
    ]

    mode = "rule_based"
    text = grounded["text"]
    if settings.anthropic_api_key and not grounded["safety"] and intent not in ("help", "diagnosis_request"):
        phrased = await _llm_rephrase(message, grounded)
        if phrased:
            text, mode = phrased, "llm_phrased"
        else:
            mode = "rule_based_llm_unavailable"

    return {
        "intent": intent,
        "mode": mode,
        "text": text,
        "measured": grounded["measured"],
        "reported": grounded["reported"],
        "citations": grounded["citations"],
        "insufficient_data": grounded["insufficient"],
        "safety_notes": safety_notes,
        "suggestions": CAPABILITIES if intent == "help" else [],
        "at": datetime.now(timezone.utc).isoformat(),
    }


def assistant_status() -> dict:
    return {
        "mode": "llm_phrased" if settings.anthropic_api_key else "rule_based",
        "description": (
            "Answers are built from your stored records by deterministic rules, then rephrased by a language model that is told not to add facts."
            if settings.anthropic_api_key
            else "Rule-based assistant: answers come from your stored records through predefined intents. No language model is configured."
        ),
        "capabilities": CAPABILITIES,
    }
