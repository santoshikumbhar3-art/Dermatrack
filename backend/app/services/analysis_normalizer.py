"""Adapter: YouCam Skin Analysis response -> DermaTrack normalised model.

Handles the two documented shapes:

1. ``format: "json"`` task result (V2.0):
   data.results.output = [
       {"type": "texture", "ui_score": 68, "raw_score": 57.33, "mask_urls": [...]},
       {"type": "all", "score": 75.7},
       {"type": "skin_age", "score": 37},
       ...
   ]
2. ``score_info.json`` from the ZIP result:
   {"wrinkle": {"raw_score": .., "ui_score": .., "output_mask_name": ..},
    "hd_pore": {"forehead": {...}, "whole": {...}}, "all": {"score": ..}, "skin_age": 37}

Score direction (from the official "Inputs & Outputs" documentation): every
``raw_score`` and ``ui_score`` runs 1–100 and a HIGHER score indicates a
healthier, more favourable reading for that concern. ``ui_score`` is adjusted
upwards on purpose by the provider, so progress calculations use ``raw_score``.

Only fields actually present in the response are emitted. Nothing is filled in.
"""
from __future__ import annotations

import copy
import re
from typing import Any

# Documented SD and HD concern keys and their display labels.
SD_CONCERNS = {
    "wrinkle": "Wrinkles",
    "droopy_upper_eyelid": "Upper eyelid",
    "droopy_lower_eyelid": "Lower eyelid",
    "firmness": "Firmness",
    "acne": "Acne",
    "moisture": "Moisture",
    "eye_bag": "Eye bags",
    "dark_circle_v2": "Dark circles",
    "age_spot": "Age spots",
    "radiance": "Radiance",
    "redness": "Redness",
    "oiliness": "Oiliness",
    "pore": "Pores",
    "texture": "Texture",
    "tear_trough": "Tear trough",
}
HD_CONCERNS = {f"hd_{k}": v for k, v in SD_CONCERNS.items() if k != "dark_circle_v2"}
HD_CONCERNS["hd_dark_circle"] = "Dark circles"

# The concerns DermaTrack requests by default. Skin type is excluded because it
# returns a category, not a comparable score.
DEFAULT_SD_ACTIONS = [
    "acne", "pore", "texture", "wrinkle", "redness", "oiliness",
    "moisture", "radiance", "age_spot", "dark_circle_v2", "eye_bag", "firmness",
]
DEFAULT_HD_ACTIONS = [f"hd_{a}" if a != "dark_circle_v2" else "hd_dark_circle" for a in DEFAULT_SD_ACTIONS]

ALL_LABELS = {**SD_CONCERNS, **HD_CONCERNS}

# Canonical metric key used across SD/HD for display grouping ("hd_pore" -> "pore").
def canonical_key(k: str) -> str:
    k = k[3:] if k.startswith("hd_") else k
    return "dark_circle" if k in ("dark_circle_v2", "dark_circle") else k


REGION_LABEL = {
    "whole": "Whole face",
    "forehead": "Forehead",
    "nose": "Nose",
    "cheek": "Cheeks",
    "glabellar": "Between brows",
    "crowfeet": "Crow's feet",
    "periocular": "Around eyes",
    "nasolabial": "Nasolabial",
    "marionette": "Marionette",
}


class UnexpectedResponse(ValueError):
    """The provider response did not match any documented shape."""


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return None


def _metric(key: str, region: str | None, node: dict) -> dict | None:
    raw = _num(node.get("raw_score"))
    ui = _num(node.get("ui_score"))
    if raw is None and ui is None:
        return None
    return {
        "key": key,
        "canonical": canonical_key(key),
        "label": ALL_LABELS.get(key, key.replace("_", " ").title()),
        "region": region,
        "region_label": REGION_LABEL.get(region, region) if region else None,
        "raw_score": round(raw, 2) if raw is not None else None,
        "ui_score": int(round(ui)) if ui is not None else None,
        "direction": "higher_is_better",
        "scale": "1-100",
    }


def normalize(payload: dict) -> dict:
    """Return {overall_score, skin_age, metrics[], unmapped_fields[], mask_urls{}}."""
    if not isinstance(payload, dict):
        raise UnexpectedResponse("Response is not a JSON object.")

    data = payload.get("data", payload)
    results = data.get("results") if isinstance(data, dict) else None
    output = results.get("output") if isinstance(results, dict) else None

    metrics: list[dict] = []
    unmapped: list[str] = []
    masks: dict[str, list[str]] = {}
    overall = None
    skin_age = None

    if isinstance(output, list):
        for entry in output:
            if not isinstance(entry, dict):
                continue
            t = str(entry.get("type", ""))
            if t == "all":
                overall = _num(entry.get("score"))
                continue
            if t == "skin_age":
                skin_age = _num(entry.get("score"))
                continue
            m = _metric(t, None, entry)
            if m:
                metrics.append(m)
                if isinstance(entry.get("mask_urls"), list):
                    masks[t] = [u for u in entry["mask_urls"] if isinstance(u, str)]
            elif t:
                unmapped.append(t)
    elif isinstance(data, dict) and any(k in ALL_LABELS or k in ("all", "skin_age") for k in data):
        # score_info.json shape
        for k, v in data.items():
            if k == "all":
                overall = _num(v.get("score")) if isinstance(v, dict) else _num(v)
                continue
            if k == "skin_age":
                skin_age = _num(v.get("score")) if isinstance(v, dict) else _num(v)
                continue
            if not isinstance(v, dict):
                unmapped.append(k)
                continue
            m = _metric(k, None, v)
            if m:
                metrics.append(m)
                continue
            sub_found = False
            for region, node in v.items():
                if isinstance(node, dict):
                    m = _metric(k, region, node)
                    if m:
                        metrics.append(m)
                        sub_found = True
            if not sub_found:
                unmapped.append(k)
    else:
        raise UnexpectedResponse("Response has no 'results.output' list or score fields.")

    if not metrics and overall is None:
        raise UnexpectedResponse("Response contained no recognisable scores.")

    # Prefer the whole-face region for summary display when regions exist.
    metrics.sort(key=lambda m: (m["canonical"], m["region"] not in (None, "whole"), m["region"] or ""))
    return {
        "overall_score": round(overall, 2) if overall is not None else None,
        "skin_age": skin_age,
        "metrics": metrics,
        "unmapped_fields": sorted(set(unmapped)),
        "mask_urls": masks,
    }


_URL_RE = re.compile(r"https?://\S+")


def redact(payload: Any) -> Any:
    """Deep copy with all URLs (pre-signed, time-limited, image-bearing) replaced."""

    def walk(x):
        if isinstance(x, dict):
            return {k: walk(v) for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v) for v in x]
        if isinstance(x, str) and _URL_RE.search(x):
            return "[redacted-url]"
        return x

    return walk(copy.deepcopy(payload))
