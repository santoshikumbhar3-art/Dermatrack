"""Exercises the live YouCam client against a mocked transport that follows the
documented request/response shapes (no network, no real key)."""
import asyncio
import json

import httpx
import pytest

from app import config
from app.services import youcam_client as yc


@pytest.fixture(autouse=True)
def fake_key(monkeypatch):
    s = config.Settings()
    object.__setattr__(s, "youcam_api_key", "test-key")
    object.__setattr__(s, "youcam_poll_interval_s", 0.0)
    object.__setattr__(s, "youcam_timeout_s", 2)
    monkeypatch.setattr(yc, "settings", s)


def run(handler):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return asyncio.run(yc.run_skin_analysis(b"\x89PNGfake", "image/png", "scan.png", client))


def documented_handler(final_status="success", polls_before=1, task_error=None):
    state = {"polls": 0, "seen": []}

    def h(req: httpx.Request):
        state["seen"].append((req.method, req.url.path))
        if req.url.path == "/s2s/v2.0/file":
            assert req.headers["authorization"] == "Bearer test-key"
            body = json.loads(req.content)
            assert body["files"][0]["file_size"] == 8
            return httpx.Response(200, json={"status": 200, "data": {"files": [{"file_id": "FID", "requests": [{"method": "PUT", "url": "https://upload.example/put?sig=1", "headers": {"Content-Type": "image/png"}}]}]}})
        if req.url.host == "upload.example":
            assert "authorization" not in req.headers  # key never sent to storage
            return httpx.Response(200)
        if req.url.path == "/s2s/v2.0/task/skin-analysis" and req.method == "POST":
            body = json.loads(req.content)
            assert body["src_file_id"] == "FID" and body["format"] == "json"
            assert not any(a.startswith("hd_") for a in body["dst_actions"])  # no SD/HD mixing
            return httpx.Response(200, json={"status": 200, "data": {"task_id": "TID"}})
        if req.url.path == "/s2s/v2.0/task/skin-analysis/TID":
            state["polls"] += 1
            if state["polls"] <= polls_before:
                return httpx.Response(200, json={"status": 200, "data": {"task_status": "running"}})
            if final_status == "error":
                return httpx.Response(200, json={"status": 200, "data": {"task_status": "error", "error": task_error}})
            return httpx.Response(200, json={"status": 200, "data": {"task_status": "success", "results": {"output": [{"type": "acne", "ui_score": 80, "raw_score": 70.1}, {"type": "all", "score": 72}]}}})
        return httpx.Response(404)

    return h, state


def test_full_documented_flow():
    h, state = documented_handler()
    payload, task_id = run(h)
    assert task_id == "TID"
    assert payload["data"]["task_status"] == "success"
    assert state["polls"] == 2


def test_task_error_maps_to_guidance():
    h, _ = documented_handler(final_status="error", task_error="error_src_face_too_small")
    with pytest.raises(yc.AnalysisError) as e:
        run(h)
    assert e.value.code == "error_src_face_too_small" and "60%" in e.value.message


def test_auth_and_quota_errors():
    with pytest.raises(yc.AnalysisError) as e:
        run(lambda r: httpx.Response(401, json={"status": 401, "error": "Unauthorized"}))
    assert e.value.code == "auth_failed"
    with pytest.raises(yc.AnalysisError) as e:
        run(lambda r: httpx.Response(403, json={"status": 403, "error": "Insufficient credits"}))
    assert e.value.code == "quota_exhausted"
    with pytest.raises(yc.AnalysisError) as e:
        run(lambda r: httpx.Response(429, json={}))
    assert e.value.code == "rate_limited" and e.value.retryable


def test_malformed_file_response():
    with pytest.raises(yc.AnalysisError) as e:
        run(lambda r: httpx.Response(200, json={"data": {}}))
    assert e.value.code == "unexpected_response"


def test_timeout():
    h, _ = documented_handler(polls_before=10_000)
    with pytest.raises(yc.AnalysisError) as e:
        run(h)
    assert e.value.code == "timeout"


def test_network_error():
    def boom(_):
        raise httpx.ConnectError("down")

    with pytest.raises(yc.AnalysisError) as e:
        run(boom)
    assert e.value.code == "network_error"
