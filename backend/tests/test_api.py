from datetime import date, timedelta

from .conftest import make_image


def scan(client, consent=True, img=None, **conds):
    return client.post(
        "/api/analyze",
        files={"image": ("selfie.png", img or make_image(), "image/png")},
        data={"consent": str(consent).lower(), **conds},
    )


def test_health_reports_fixture_mode(client):
    r = client.get("/api/health").json()
    assert r["analysis_source"] == "dev_fixture"
    assert "key" not in str(r).lower() or r["youcam_configured"] is False


def test_consent_required(client):
    r = scan(client, consent=False)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "consent_required"


def test_upload_validation(client):
    assert scan(client, img=make_image(300, 400)).json()["detail"]["code"] == "image_too_small"
    assert scan(client, img=b"not an image").json()["detail"]["code"] == "invalid_image"
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (600, 800)).save(buf, format="GIF")
    assert scan(client, img=buf.getvalue()).json()["detail"]["code"] == "unsupported_format"


def test_fixture_scan_is_labelled_and_saved(client):
    r = scan(client, lighting="Daylight")
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["source"] == "dev_fixture"
    assert "not an analysis of your photo" in a["note"]
    assert a["capture_conditions"] == {"lighting": "Daylight"}
    assert len(client.get("/api/analysis/history").json()) == 1
    detail = client.get(f"/api/analysis/{a['id']}").json()
    assert "raw_response_redacted" in detail


def test_progress_single_scan_needs_another(client):
    scan(client)
    p = client.get("/api/progress").json()
    assert "Another scan is needed" in p["summary"]["headline"]
    assert p["comparison"] is None


def test_progress_no_change_with_identical_fixture(client):
    scan(client)
    scan(client)
    p = client.get("/api/progress").json()
    assert p["comparison"]["comparable"]
    assert all(m["status"] == "no_clear_change" for m in p["comparison"]["metrics"])
    g = client.get("/api/guidance").json()
    assert any(c["id"] == "G-SCAN-NO-CHANGE" for c in g["cards"])


def _add(client, **kw):
    body = {"name": "X", "slot": "pm", "category": "treatment", "actives": [], **kw}
    r = client.post("/api/routines", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_routine_crud_events_and_compat(client):
    a = _add(client, name="Retinol 0.5%", actives=[{"name": "retinol", "concentration_percent": 0.5}])
    _add(client, name="Glycolic 7%", category="exfoliant", actives=[{"name": "glycolic acid", "concentration_percent": 7}])
    data = client.get("/api/routines").json()
    ids = {f["rule_id"] for f in data["compatibility"]["findings"]}
    assert {"R-RET-ACID-01", "R-SUN-01"} <= ids
    # pause -> event
    upd = {**{k: a[k] for k in ("name", "brand", "category", "slot", "step_order", "actives", "frequency", "instructions", "notes")}, "paused": True}
    assert client.put(f"/api/routines/{a['id']}", json=upd).status_code == 200
    kinds = [e["kind"] for e in client.get("/api/routines/events").json()]
    assert "paused" in kinds
    assert client.delete(f"/api/routines/{a['id']}").status_code == 204
    assert client.get("/api/routines/events").json()[0]["kind"] == "removed"


def test_routine_validation(client):
    r = client.post("/api/routines", json={"name": "", "slot": "noon"})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "validation_error"
    future = (date.today() + timedelta(days=5)).isoformat()
    r = client.post("/api/routines", json={"name": "A", "introduced_on": future})
    assert "future" in r.json()["detail"]["message"]


def test_safety_lock_on_severe_checkin(client):
    item = _add(client, name="New retinol", actives=[{"name": "retinol"}], introduced_on=(date.today() - timedelta(days=3)).isoformat())
    r = client.post("/api/checkins", json={"symptoms": {"burning": 3}, "red_flags": ["blistering"], "suspected_item_ids": [item["id"]]})
    assert r.status_code == 201
    g = r.json()["guidance"]
    assert g["safety_active"]
    top = g["cards"][0]
    assert top["level"] == "urgent" and top["safety_locked"]
    assert any("scan cannot tell" in s.lower() for s in top["suggestions"])
    # No caution card suggesting continuation
    assert not any(c["id"] == "G-IRRITATION-NEW-ACTIVE" for c in g["cards"])
    # Recommendations must simplify first
    rec = client.get("/api/products/recommendations").json()
    assert rec["simplify_first"]


def test_emergency_flags(client):
    g = client.post("/api/checkins", json={"red_flags": ["difficulty_breathing"]}).json()["guidance"]
    assert g["cards"][0]["id"] == "G-SAFE-EMERGENCY"


def test_irritation_after_new_active_is_possible_not_proven(client):
    _add(client, name="Glycolic", actives=[{"name": "glycolic acid"}], introduced_on=(date.today() - timedelta(days=5)).isoformat())
    g = client.post("/api/checkins", json={"symptoms": {"redness": 2}}).json()["guidance"]
    card = next(c for c in g["cards"] if c["id"] == "G-IRRITATION-NEW-ACTIVE")
    assert "not proven" in card["reasoning"]


def test_invalid_checkin(client):
    assert client.post("/api/checkins", json={"symptoms": {"burning": 7}}).status_code == 422
    assert client.post("/api/checkins", json={"red_flags": ["made_up"]}).status_code == 422


def test_assistant_intents_and_grounding(client):
    r = client.post("/api/assistant/message", json={"message": "What changed since my last scan?"}).json()
    assert r["mode"] == "rule_based" and r["insufficient_data"]
    scan(client)
    scan(client)
    r = client.post("/api/assistant/message", json={"message": "What changed since my last scan?"}).json()
    assert r["intent"] == "what_changed" and len(r["citations"]) >= 2
    assert "not proof" in r["text"]
    r = client.post("/api/assistant/message", json={"message": "Do I have rosacea?"}).json()
    assert r["intent"] == "diagnosis_request" and "can't diagnose" in r["text"]
    r = client.post("/api/assistant/message", json={"message": "my lips are swelling"}).json()
    assert r["intent"] == "emergency"


def test_recommendations_explain_and_no_prices(client):
    rec = client.get("/api/products/recommendations").json()
    assert set(rec["gaps"]) == {"cleanser", "moisturiser", "sunscreen"}
    assert rec["matches"]
    m = rec["matches"][0]
    assert m["reasons"] and any("Price not verified" in x for x in m["missing_information"])
    assert all(p["price"] is None for p in client.get("/api/products").json())


def test_user_product_price_requires_currency(client):
    r = client.post("/api/products", json={"name": "A", "brand": "B", "category": "serum", "price": 500})
    assert r.status_code == 422
    r = client.post("/api/products", json={"name": "A", "brand": "B", "category": "serum", "price": 500, "currency": "INR"})
    assert r.status_code == 201 and r.json()["price_source"] == "Entered by you"


def test_demo_load_clear_and_export_delete(client):
    assert client.post("/api/demo/load").status_code == 201
    o = client.get("/api/overview").json()
    assert o["has_demo"] and o["latest_scan"]["source"] == "demo_sample"
    p = client.get("/api/progress").json()
    assert p["group"]["data_class"] == "demo" and p["comparison"]["comparable"]
    # Fixture scans are never mixed with demo scans; the larger group is charted
    scan(client)
    p = client.get("/api/progress").json()
    assert p["group"]["data_class"] == "demo" and len(p["excluded_scan_ids"]) == 1
    assert all(pt["analysis_id"] not in p["excluded_scan_ids"] for s in p["series"] for pt in s["points"])
    assert client.delete("/api/demo").status_code == 204
    assert not client.get("/api/overview").json()["has_demo"]
    exp = client.get("/api/export").json()
    assert len(exp["scans"]) == 1
    assert client.delete("/api/data").status_code == 204
    assert client.get("/api/analysis/history").json() == []
