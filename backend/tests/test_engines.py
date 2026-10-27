from datetime import date, timedelta

import pytest

from app.services.analysis_normalizer import UnexpectedResponse, normalize, redact
from app.services.ingredient_rules import build_product, evaluate, resolve


# ---------------------------------------------------------------- normaliser
def test_normalize_v2_output_list():
    payload = {
        "status": 200,
        "data": {
            "task_status": "success",
            "results": {
                "output": [
                    {"type": "texture", "ui_score": 68, "raw_score": 57.33, "mask_urls": ["https://x/sig?a=1"]},
                    {"type": "pore", "ui_score": 92, "raw_score": 95.34},
                    {"type": "all", "score": 75.7},
                    {"type": "skin_age", "score": 37},
                    {"type": "resize_image", "url": "https://x/r.jpg"},
                ]
            },
        },
    }
    n = normalize(payload)
    assert n["overall_score"] == 75.7
    assert n["skin_age"] == 37
    assert {m["key"] for m in n["metrics"]} == {"texture", "pore"}
    assert all(m["direction"] == "higher_is_better" for m in n["metrics"])
    assert "resize_image" in n["unmapped_fields"]
    assert n["mask_urls"]["texture"] == ["https://x/sig?a=1"]


def test_normalize_score_info_with_regions():
    n = normalize({"hd_pore": {"nose": {"raw_score": 29.1, "ui_score": 58}, "whole": {"raw_score": 49.2, "ui_score": 67}}, "all": {"score": 70}, "skin_age": 30})
    regions = {m["region"] for m in n["metrics"]}
    assert regions == {"nose", "whole"}
    assert n["metrics"][0]["canonical"] == "pore"


def test_normalize_rejects_unexpected():
    with pytest.raises(UnexpectedResponse):
        normalize({"data": {"results": {"foo": 1}}})
    with pytest.raises(UnexpectedResponse):
        normalize({"data": {"results": {"output": [{"type": "x"}]}}})


def test_redact_removes_urls():
    r = redact({"a": ["https://secret.example/sig?x=y", "keep"], "b": {"c": "http://u"}})
    assert r == {"a": ["[redacted-url]", "keep"], "b": {"c": "[redacted-url]"}}


# ------------------------------------------------------------ ingredient rules
def P(id, name, slot, actives, freq="daily", instr=""):
    return build_product(id, name, slot, freq, instr, actives, False)


def test_resolve_synonyms():
    assert resolve("Sodium Hyaluronate")[0] == "hyaluronic acid"
    assert resolve("BHA")[1] == "bha"
    assert resolve("2% salicylic acid serum")[0] == "salicylic acid"
    assert resolve("unobtainium") == (None, None)


def test_retinoid_plus_aha_is_precaution_not_forbidden():
    out = evaluate([P(1, "Retinol", "pm", [{"name": "retinol"}]), P(2, "Glycolic", "pm", [{"name": "glycolic acid"}]), P(3, "SPF", "am", [{"name": "spf"}])])
    f = [x for x in out["findings"] if x["rule_id"] == "R-RET-ACID-01"]
    assert f and f[0]["severity"] == "precaution"
    assert not any(x["severity"] == "documented_concern" for x in out["findings"])


def test_alternating_frequency_downgrades():
    out = evaluate([
        P(1, "Retinol", "pm", [{"name": "retinol"}], "alternate_days"),
        P(2, "Glycolic", "pm", [{"name": "glycolic acid"}], "2_3_week"),
        P(3, "SPF", "am", [{"name": "spf"}]),
    ])
    f = next(x for x in out["findings"] if x["rule_id"] == "R-RET-ACID-01")
    assert f["severity"] == "info" and f["frequency_note"]


def test_different_slots_not_flagged():
    out = evaluate([P(1, "Retinol", "pm", [{"name": "retinol"}]), P(2, "BHA", "am", [{"name": "salicylic acid"}]), P(3, "SPF", "am", [{"name": "spf"}])])
    assert not any(x["rule_id"] == "R-RET-ACID-01" for x in out["findings"])


def test_tretinoin_bpo_documented():
    out = evaluate([P(1, "Tret", "pm", [{"name": "tretinoin"}]), P(2, "BPO", "pm", [{"name": "benzoyl peroxide"}]), P(3, "SPF", "am", [{"name": "spf"}])])
    assert any(x["rule_id"] == "R-BPO-TRET-01" and x["severity"] == "documented_concern" for x in out["findings"])


def test_missing_sunscreen_and_incomplete_and_concentration():
    out = evaluate([P(1, "AHA", "pm", [{"name": "glycolic acid", "concentration_percent": 12}]), P(2, "Mystery", "pm", []), P(3, "BHA", "am", [{"name": "salicylic acid", "concentration_percent": 5}])])
    ids = {x["rule_id"] for x in out["findings"]}
    assert {"R-SUN-01", "R-INCOMPLETE-01", "R-CONC-AHA-01", "R-CONC-SAL-01"} <= ids
    assert "could not be evaluated" in out["summary"]


def test_paused_products_ignored():
    a = P(1, "Retinol", "pm", [{"name": "retinol"}])
    b = build_product(2, "Glycolic", "pm", "daily", "", [{"name": "glycolic acid"}], False, paused=True)
    out = evaluate([a, b, P(3, "SPF", "am", [{"name": "spf"}])])
    assert not any(x["rule_id"] == "R-RET-ACID-01" for x in out["findings"])


def test_new_actives_cluster():
    today = date.today()
    a, b = P(1, "Retinol", "pm", [{"name": "retinol"}]), P(2, "AHA", "am", [{"name": "lactic acid"}])
    out = evaluate([a, b, P(3, "SPF", "am", [{"name": "spf"}])], introduced={1: today - timedelta(days=3), 2: today - timedelta(days=8)})
    assert any(x["rule_id"] == "R-NEW-ACTIVE-01" for x in out["findings"])
