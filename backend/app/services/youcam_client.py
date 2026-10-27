"""YouCam AI Skin Analysis client (server-side only).

Implements the documented V2.0 flow
(https://docs.perfectcorp.com/reference/ai_skin_analysis/section/overview/inputs-and-outputs):

1. ``POST /s2s/v2.0/file``                      -> file_id + pre-signed upload request
2. ``PUT  <pre-signed url>``                     -> upload the image bytes
3. ``POST /s2s/v2.0/task/skin-analysis``         -> task_id
4. ``GET  /s2s/v2.0/task/skin-analysis/{task_id}`` until task_status is success | error

Authentication: ``Authorization: Bearer <YOUCAM_API_KEY>``. The key is read
from the environment and is never logged or returned.

Units are only consumed when a task succeeds (per the docs), so a failed task
is surfaced to the user rather than silently retried.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

import httpx

from ..config import settings
from .analysis_normalizer import DEFAULT_HD_ACTIONS, DEFAULT_SD_ACTIONS

log = logging.getLogger("dermatrack.youcam")

API_VERSION = "s2s/v2.0"

# Documented task error codes -> user-facing guidance.
TASK_ERROR_MESSAGES = {
    "error_below_min_image_size": "The photo resolution is too small for skin analysis. Use a photo whose shorter side is at least {min}px.",
    "error_exceed_max_image_size": "The photo resolution is too large. Try a smaller photo.",
    "error_src_face_too_small": "Your face is too small in the frame. Move closer so your face fills at least 60% of the photo's width.",
    "error_src_face_out_of_bound": "Part of your face is outside the frame. Centre your face with a little space around it.",
    "error_lighting_dark": "The photo is too dark. Try again facing an even, bright light source.",
    "error_large_face_angle": "Your head is turned or tilted too much. Look straight at the camera.",
}


@dataclass
class AnalysisError(Exception):
    code: str
    message: str
    http_status: int = 502
    retryable: bool = False

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "retryable": self.retryable}


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.youcam_api_key}", "Content-Type": "application/json"}


def _provider_error(resp: httpx.Response, stage: str) -> AnalysisError:
    try:
        body = resp.json()
    except ValueError:
        body = {}
    err_code = str(body.get("error_code") or "")
    err_text = str(body.get("error") or body.get("message") or "")
    blob = f"{err_code} {err_text}".lower()
    s = resp.status_code
    if s in (401,) or "unauthor" in blob or "invalid api key" in blob or "apikey" in blob:
        return AnalysisError("auth_failed", "The YouCam API rejected the server's API key. Check YOUCAM_API_KEY in the backend .env file.", 502)
    if s == 402 or any(k in blob for k in ("credit", "unit", "insufficient", "quota", "balance")):
        return AnalysisError("quota_exhausted", "The YouCam account has run out of API units. Top up units in the YouCam API console, then try again.", 503)
    if s == 429:
        return AnalysisError("rate_limited", "Too many requests to the YouCam API. Wait a moment and try again.", 503, retryable=True)
    if s == 403:
        return AnalysisError("forbidden", "The YouCam API refused this request (403). Check that the API key is active for AI Skin Analysis.", 502)
    if s == 400:
        return AnalysisError("invalid_request", f"YouCam rejected the request at the {stage} step: {err_text or err_code or 'invalid parameters'}.", 502)
    if s >= 500:
        return AnalysisError("provider_unavailable", "The YouCam API is temporarily unavailable. Try again shortly.", 503, retryable=True)
    return AnalysisError("provider_error", f"Unexpected YouCam response ({s}) at the {stage} step.", 502)


def _extract_task_error(data: dict) -> str:
    for k in ("error", "error_code", "error_message", "message"):
        v = data.get(k)
        if isinstance(v, str) and v:
            return v
    return ""


async def run_skin_analysis(
    image_bytes: bytes, content_type: str, file_name: str, client: httpx.AsyncClient | None = None
) -> tuple[dict, str]:
    """Run a full live analysis. Returns (provider_payload, task_id). Raises AnalysisError."""
    if not settings.youcam_configured:
        raise AnalysisError("not_configured", "YouCam API key is not configured on the server.", 503)

    base = settings.youcam_base_url
    actions = DEFAULT_HD_ACTIONS if settings.youcam_mode == "hd" else DEFAULT_SD_ACTIONS
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
    try:
        # 1. Register the file
        try:
            r = await client.post(
                f"{base}/{API_VERSION}/file",
                headers=_headers(),
                json={"files": [{"content_type": content_type, "file_name": file_name, "file_size": len(image_bytes)}]},
            )
        except httpx.HTTPError as e:
            raise AnalysisError("network_error", "Could not reach the YouCam API. Check the server's internet connection.", 503, True) from e
        if r.status_code != 200:
            raise _provider_error(r, "file registration")
        try:
            f = r.json()["data"]["files"][0]
            file_id = f["file_id"]
            req = f["requests"][0]
            upload_url = req["url"]
            upload_headers = req.get("headers") or {"Content-Type": content_type}
            upload_method = (req.get("method") or "PUT").upper()
        except (KeyError, IndexError, TypeError, ValueError) as e:
            raise AnalysisError("unexpected_response", "YouCam's file API returned an unexpected structure.", 502) from e

        # 2. Upload bytes to the pre-signed URL (no Authorization header — the URL is signed)
        try:
            up = await client.request(upload_method, upload_url, headers=upload_headers, content=image_bytes)
        except httpx.HTTPError as e:
            raise AnalysisError("upload_failed", "Uploading the photo to YouCam storage failed. Please try again.", 503, True) from e
        if up.status_code not in (200, 201, 204):
            raise AnalysisError("upload_failed", f"Uploading the photo to YouCam storage failed ({up.status_code}).", 502, True)

        # 3. Create the task
        try:
            t = await client.post(
                f"{base}/{API_VERSION}/task/skin-analysis",
                headers=_headers(),
                json={
                    "src_file_id": file_id,
                    "dst_actions": actions,
                    "miniserver_args": {"enable_mask_overlay": False},
                    "format": "json",
                },
            )
        except httpx.HTTPError as e:
            raise AnalysisError("network_error", "Could not reach the YouCam API to start the analysis.", 503, True) from e
        if t.status_code != 200:
            raise _provider_error(t, "task creation")
        try:
            task_id = t.json()["data"]["task_id"]
        except (KeyError, TypeError, ValueError) as e:
            raise AnalysisError("unexpected_response", "YouCam's task API returned an unexpected structure.", 502) from e

        # 4. Poll
        deadline = time.monotonic() + settings.youcam_timeout_s
        while True:
            await asyncio.sleep(settings.youcam_poll_interval_s)
            try:
                p = await client.get(f"{base}/{API_VERSION}/task/skin-analysis/{task_id}", headers=_headers())
            except httpx.HTTPError:
                if time.monotonic() > deadline:
                    raise AnalysisError("timeout", "The analysis is taking longer than expected. Please try again.", 504, True)
                continue
            if p.status_code != 200:
                raise _provider_error(p, "result polling")
            try:
                payload = p.json()
                data = payload["data"]
                status = str(data.get("task_status", "")).lower()
            except (KeyError, TypeError, ValueError) as e:
                raise AnalysisError("unexpected_response", "YouCam's result API returned an unexpected structure.", 502) from e
            if status == "success":
                log.info("youcam task succeeded")  # never log ids, images or keys
                return payload, task_id
            if status == "error":
                code = _extract_task_error(data)
                msg = TASK_ERROR_MESSAGES.get(code, "YouCam could not analyse this photo{detail}. No units were charged.")
                msg = msg.format(min=settings.min_short_side, detail=f" ({code})" if code else "")
                raise AnalysisError(code or "task_failed", msg, 422)
            if time.monotonic() > deadline:
                raise AnalysisError(
                    "timeout",
                    "The analysis did not finish in time. Results are kept by YouCam for 24 hours, but this scan was not saved. Please try again.",
                    504,
                    True,
                )
    finally:
        if own_client:
            await client.aclose()


# ---------------------------------------------------------------------------
# Development-only fixture
# ---------------------------------------------------------------------------
# This is the sample SD "score_info.json" published in YouCam's own
# documentation (Inputs & Outputs page). It is NOT an analysis of the uploaded
# photo. It is used only when no API key is configured and DEV_FIXTURE_ENABLED
# is true, and every record created from it is labelled source="dev_fixture".
DOCS_SAMPLE_SD_SCORE_INFO = {
    "wrinkle": {"raw_score": 36.09360456466675, "ui_score": 60},
    "firmness": {"raw_score": 89.66898322105408, "ui_score": 85},
    "acne": {"raw_score": 92.29713000000001, "ui_score": 88},
    "moisture": {"raw_score": 48.694559931755066, "ui_score": 70},
    "eye_bag": {"raw_score": 76.67280435562134, "ui_score": 79},
    "dark_circle_v2": {"raw_score": 80.1993191242218, "ui_score": 76},
    "age_spot": {"raw_score": 83.23274230957031, "ui_score": 77},
    "radiance": {"raw_score": 76.57244205474854, "ui_score": 79},
    "redness": {"raw_score": 72.011962890625, "ui_score": 77},
    "oiliness": {"raw_score": 60.74365234375, "ui_score": 72},
    "pore": {"raw_score": 88.38014125823975, "ui_score": 84},
    "texture": {"raw_score": 80.09742498397827, "ui_score": 76},
    "all": {"score": 75.75757575757575},
    "skin_age": 37,
}


def dev_fixture_payload() -> dict:
    output = [{"type": k, **v} for k, v in DOCS_SAMPLE_SD_SCORE_INFO.items() if k not in ("all", "skin_age")]
    output.append({"type": "all", "score": DOCS_SAMPLE_SD_SCORE_INFO["all"]["score"]})
    output.append({"type": "skin_age", "score": DOCS_SAMPLE_SD_SCORE_INFO["skin_age"]})
    return {"status": 200, "data": {"task_status": "success", "results": {"output": output}}}
