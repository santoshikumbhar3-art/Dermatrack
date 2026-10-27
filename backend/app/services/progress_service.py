"""Longitudinal progress calculations.

Formulas (documented in the UI as well)
---------------------------------------
YouCam documents both ``raw_score`` and ``ui_score`` on a 1–100 scale where a
HIGHER score is MORE favourable. Progress therefore uses:

    change (points)   = current_raw - baseline_raw
    relative change % = (current_raw - baseline_raw) / baseline_raw × 100   (baseline_raw > 0)

A positive change means the AI measurement moved in the favourable direction.
These are changes in an AI image measurement, not percentages of biological
improvement. The prompt's "concern" formula ((baseline - current)/baseline) is
for metrics where higher means *more* of a concern; it does not apply to these
YouCam fields, so it is not used.

``ui_score`` is not used for calculations because the provider documents that
it is adjusted upwards to be encouraging.

Comparability: scans are only compared when they share the same ``mode``
(SD vs HD), ``api_version`` and data class (real vs development fixture vs
demonstration sample).

Variation band: changes smaller than ``NOISE_BAND_POINTS`` are reported as
"no clear change". This band is a conservative heuristic chosen for this
prototype — photo-to-photo variation from lighting and angle is real but its
size has not been measured for this app. It is configurable and disclosed.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Analysis, CheckIn, RoutineEvent

NOISE_BAND_POINTS = 3.0

DATA_CLASS = {"youcam": "real", "dev_fixture": "fixture", "demo_sample": "demo"}


def comparability_key(a: Analysis) -> tuple:
    return (a.mode, a.api_version, DATA_CLASS.get(a.source, a.source))


def primary_group_key(scans: list[Analysis]) -> tuple | None:
    """Which comparable group to chart: real YouCam scans always win; otherwise
    the group with the most scans (ties go to the most recent)."""
    if not scans:
        return None
    groups: dict[tuple, list[Analysis]] = {}
    for s in scans:
        groups.setdefault(comparability_key(s), []).append(s)
    real = [k for k in groups if k[2] == "real"]
    pool = real or list(groups)
    return max(pool, key=lambda k: (len(groups[k]), max(_as_utc(s.created_at) for s in groups[k])))


def _whole_metrics(a: Analysis) -> dict[str, dict]:
    """canonical metric -> whole-face metric dict (region None or 'whole')."""
    out = {}
    for m in a.metrics or []:
        if m.get("region") in (None, "whole") and m.get("raw_score") is not None:
            out[m["canonical"]] = m
    return out


def _as_utc(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def compare(baseline: Analysis, current: Analysis) -> dict:
    if comparability_key(baseline) != comparability_key(current):
        return {
            "comparable": False,
            "reason": (
                "These scans cannot be compared: they use different analysis modes, API versions, or data "
                "types (real, development fixture, or demonstration sample)."
            ),
            "baseline_id": baseline.id,
            "current_id": current.id,
            "metrics": [],
        }
    b, c = _whole_metrics(baseline), _whole_metrics(current)
    rows = []
    for key in sorted(set(b) & set(c)):
        br, cr = b[key]["raw_score"], c[key]["raw_score"]
        delta = round(cr - br, 2)
        rel = round(delta / br * 100, 1) if br and br > 0 else None
        if abs(delta) < NOISE_BAND_POINTS:
            status = "no_clear_change"
        elif delta > 0:
            status = "more_favourable"
        else:
            status = "less_favourable"
        rows.append(
            {
                "canonical": key,
                "label": c[key]["label"],
                "baseline_raw": br,
                "current_raw": cr,
                "baseline_ui": b[key].get("ui_score"),
                "current_ui": c[key].get("ui_score"),
                "delta_points": delta,
                "relative_change_percent": rel,
                "status": status,
            }
        )
    days = (_as_utc(current.created_at) - _as_utc(baseline.created_at)).total_seconds() / 86400
    return {
        "comparable": True,
        "baseline_id": baseline.id,
        "current_id": current.id,
        "baseline_at": _as_utc(baseline.created_at).isoformat(),
        "current_at": _as_utc(current.created_at).isoformat(),
        "days_between": round(days, 1),
        "metrics": rows,
        "only_in_baseline": sorted(set(b) - set(c)),
        "only_in_current": sorted(set(c) - set(b)),
        "condition_differences": condition_differences(baseline, current),
        "noise_band_points": NOISE_BAND_POINTS,
    }


CONDITION_LABELS = {
    "lighting": "lighting",
    "makeup": "makeup",
    "time_of_day": "time of day",
    "camera": "camera",
    "distance": "distance from camera",
}


def condition_differences(a: Analysis, b: Analysis) -> list[str]:
    ca, cb = a.capture_conditions or {}, b.capture_conditions or {}
    diffs = []
    for k, label in CONDITION_LABELS.items():
        va, vb = ca.get(k), cb.get(k)
        if va and vb and va != vb:
            diffs.append(f"Different {label}: “{va}” vs “{vb}”.")
        elif bool(va) != bool(vb):
            diffs.append(f"{label.capitalize()} was not recorded for one of the scans.")
    return diffs


def build_progress(db: Session, days: int | None = None) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days) if days else None

    scans_all = list(db.scalars(select(Analysis).order_by(Analysis.created_at)))
    checkins_all = list(db.scalars(select(CheckIn).order_by(CheckIn.created_at)))
    events_all = list(db.scalars(select(RoutineEvent).order_by(RoutineEvent.created_at)))

    def in_window(d: datetime) -> bool:
        return since is None or _as_utc(d) >= since

    scans = [s for s in scans_all if in_window(s.created_at)]
    checkins = [c for c in checkins_all if in_window(c.created_at)]
    events = [e for e in events_all if in_window(e.created_at)]

    # Series grouped by comparability group, using the latest scan's group as primary.
    primary_group = primary_group_key(scans_all)
    group_scans = [s for s in scans if comparability_key(s) == primary_group] if primary_group else []
    excluded = [s.id for s in scans if primary_group and comparability_key(s) != primary_group]

    series: dict[str, dict] = {}
    for s in group_scans:
        for key, m in _whole_metrics(s).items():
            entry = series.setdefault(key, {"canonical": key, "label": m["label"], "points": []})
            entry["points"].append(
                {"analysis_id": s.id, "at": _as_utc(s.created_at).isoformat(), "raw": m["raw_score"], "ui": m.get("ui_score")}
            )
    overall = [
        {"analysis_id": s.id, "at": _as_utc(s.created_at).isoformat(), "value": s.overall_score}
        for s in group_scans
        if s.overall_score is not None
    ]

    comparison = None
    if len(group_scans) >= 2:
        comparison = compare(group_scans[0], group_scans[-1])

    timeline = []
    for s in scans:
        timeline.append(
            {
                "kind": "scan",
                "id": s.id,
                "at": _as_utc(s.created_at).isoformat(),
                "title": "Skin scan",
                "detail": f"Overall {s.overall_score:.0f}" if s.overall_score is not None else "Scan saved",
                "source": s.source,
                "is_demo": s.is_demo,
            }
        )
    for c in checkins:
        reported = {k: v for k, v in (c.symptoms or {}).items() if v}
        timeline.append(
            {
                "kind": "checkin",
                "id": c.id,
                "at": _as_utc(c.created_at).isoformat(),
                "title": "Check-in",
                "detail": ", ".join(f"{k.replace('_', ' ')} ({v}/3)" for k, v in reported.items()) or "No symptoms reported",
                "confounders": c.confounders,
                "is_demo": c.is_demo,
            }
        )
    for e in events:
        timeline.append(
            {
                "kind": "routine",
                "id": e.id,
                "at": _as_utc(e.created_at).isoformat(),
                "title": f"{e.kind.capitalize()}: {e.item_name}",
                "detail": e.detail,
                "is_demo": e.is_demo,
            }
        )
    timeline.sort(key=lambda t: t["at"], reverse=True)

    return {
        "window_days": days,
        "scan_count": len(scans),
        "comparable_scan_count": len(group_scans),
        "excluded_scan_ids": excluded,
        "group": {"mode": primary_group[0], "api_version": primary_group[1], "data_class": primary_group[2]} if primary_group else None,
        "series": list(series.values()),
        "overall": overall,
        "comparison": comparison,
        "timeline": timeline,
        "summary": summarize(group_scans, comparison, checkins),
        "method": {
            "formula": "change = current raw_score − baseline raw_score; relative % = change ÷ baseline raw_score × 100",
            "direction": "YouCam documents higher scores as more favourable for every concern.",
            "noise_band_points": NOISE_BAND_POINTS,
            "noise_band_note": "Changes under this many points are shown as 'no clear change'. Heuristic, not a validated threshold.",
            "label": "Changes in AI image measurements — not percentages of biological improvement.",
        },
    }


def summarize(scans: list[Analysis], comparison: dict | None, checkins: list[CheckIn]) -> dict:
    if not scans:
        return {"headline": "No scans yet.", "changed": [], "uncertain": ["Complete a first scan to set a baseline."]}
    if len(scans) == 1:
        return {
            "headline": "Baseline recorded. Another scan is needed before any trend can be shown.",
            "changed": [],
            "uncertain": ["One scan cannot show change. Re-scan in similar lighting after at least a week."],
        }
    changed, uncertain = [], []
    rows = comparison["metrics"] if comparison and comparison.get("comparable") else []
    for r in rows:
        if r["status"] != "no_clear_change":
            direction = "more favourable" if r["delta_points"] > 0 else "less favourable"
            changed.append(f"{r['label']}: {r['delta_points']:+.1f} points ({direction} AI measurement)")
    if comparison and comparison.get("condition_differences"):
        uncertain.extend(comparison["condition_differences"])
    conf = sorted({c for ci in checkins for c in (ci.confounders or [])})
    if conf:
        uncertain.append("Possible confounding factors reported in check-ins: " + ", ".join(conf) + ".")
    if len(scans) < 3:
        uncertain.append("With only two scans, a single change could be photo-to-photo variation.")
    if not changed:
        headline = "The available scans do not show a clear change beyond normal variation."
    else:
        headline = f"{len(changed)} measurement{'s' if len(changed) > 1 else ''} moved beyond the variation band between your first and latest comparable scans."
    return {"headline": headline, "changed": changed, "uncertain": uncertain}
