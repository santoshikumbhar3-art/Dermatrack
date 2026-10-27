from __future__ import annotations

import io
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Analysis
from ..services import youcam_client
from ..services.analysis_normalizer import UnexpectedResponse, normalize, redact
from ..services.progress_service import compare
from .deps import get_profile
from .serializers import analysis_out

router = APIRouter(prefix="/api", tags=["analysis"])
log = logging.getLogger("dermatrack.analysis")

ALLOWED = {"JPEG": "image/jpeg", "PNG": "image/png"}


def _error(status: int, code: str, message: str, retryable: bool = False) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": {"code": code, "message": message, "retryable": retryable}})


@router.get("/analysis/config")
def analysis_config() -> dict:
    return {
        "source": settings.analysis_source,
        "mode": settings.youcam_mode,
        "min_short_side": settings.min_short_side,
        "max_bytes": settings.max_upload_bytes,
        "formats": ["image/jpeg", "image/png"],
        "provider": "YouCam AI Skin Analysis (Perfect Corp.)",
        "fixture_notice": (
            "Development fixture active: no YouCam API key is configured, so scans return YouCam's published "
            "documentation sample — not an analysis of your photo."
            if settings.analysis_source == "dev_fixture"
            else None
        ),
    }


@router.post("/analyze", status_code=201)
async def analyze(
    image: UploadFile = File(...),
    consent: bool = Form(False),
    lighting: str = Form(""),
    makeup: str = Form(""),
    time_of_day: str = Form(""),
    camera: str = Form(""),
    distance: str = Form(""),
    note: str = Form(""),
    db: Session = Depends(get_db),
):
    profile = get_profile(db)
    if not (profile.analysis_consent or consent):
        return _error(403, "consent_required", "Please review and accept the photo-analysis consent before scanning.")
    if consent and not profile.analysis_consent:
        profile.analysis_consent = True
        profile.analysis_consent_at = datetime.now(timezone.utc)
        profile.consent_version = "2026-10"
        db.commit()

    source = settings.analysis_source
    if source == "unavailable":
        return _error(503, "not_configured", "Skin analysis isn't configured on this server. Add YOUCAM_API_KEY to the backend .env file.")

    # --- Validate the upload (read with a hard cap, never trust the declared type)
    data = await image.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        return _error(413, "file_too_large", "That file is 10 MB or larger. Please use a photo under 10 MB.")
    if not data:
        return _error(400, "empty_file", "The uploaded file is empty.")
    try:
        with Image.open(io.BytesIO(data)) as im:
            fmt = im.format
            im.verify()
        with Image.open(io.BytesIO(data)) as im:
            width, height = im.size
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        return _error(415, "invalid_image", "That file isn't a readable image. Please upload a JPG or PNG photo.")
    if fmt not in ALLOWED:
        return _error(415, "unsupported_format", f"{fmt or 'This'} format isn't supported. Please upload a JPG or PNG photo.")
    if min(width, height) < settings.min_short_side:
        return _error(
            422,
            "image_too_small",
            f"This photo is {width}×{height}px. The shorter side needs to be at least {settings.min_short_side}px for {settings.youcam_mode.upper()} skin analysis.",
        )

    content_type = ALLOWED[fmt]
    size_bytes = len(data)
    file_name = f"scan_{secrets.token_hex(6)}.{'jpg' if fmt == 'JPEG' else 'png'}"  # never the user's file name

    # --- Run analysis (live, or labelled dev fixture). No silent fallback.
    task_id = None
    if source == "youcam":
        try:
            payload, task_id = await youcam_client.run_skin_analysis(data, content_type, file_name)
        except youcam_client.AnalysisError as e:
            log.warning("analysis failed: %s", e.code)
            return _error(e.http_status, e.code, e.message, e.retryable)
    else:
        payload = youcam_client.dev_fixture_payload()
    del data

    try:
        norm = normalize(payload)
    except UnexpectedResponse as e:
        log.warning("unexpected provider response structure")
        return _error(502, "unexpected_response", f"The analysis finished but the result format was unexpected ({e}). The scan was not saved.")

    a = Analysis(
        source=source,
        mode=settings.youcam_mode,
        api_version=youcam_client.API_VERSION,
        provider_task_id=task_id,
        overall_score=norm["overall_score"],
        skin_age=norm["skin_age"],
        metrics=norm["metrics"],
        unmapped_fields=norm["unmapped_fields"],
        image_meta={"width": width, "height": height, "format": fmt, "bytes": size_bytes},
        capture_conditions={k: v.strip()[:60] for k, v in dict(lighting=lighting, makeup=makeup, time_of_day=time_of_day, camera=camera, distance=distance).items() if v.strip()},
        raw_response_redacted=redact(payload) if settings.store_redacted_raw_response else None,
        note=(note or "").strip()[:500]
        or ("Development fixture: YouCam documentation sample, not an analysis of your photo." if source == "dev_fixture" else ""),
    )
    db.add(a)
    db.commit()
    out = analysis_out(a)
    # Mask URLs are pre-signed and expire; returned once, never stored.
    out["mask_urls"] = norm["mask_urls"]
    return out


@router.get("/analysis/history")
def history(db: Session = Depends(get_db)) -> list[dict]:
    return [analysis_out(a) for a in db.scalars(select(Analysis).order_by(Analysis.created_at.desc()))]


@router.get("/analysis/compare")
def compare_scans(a: int, b: int, db: Session = Depends(get_db)) -> dict:
    sa, sb = db.get(Analysis, a), db.get(Analysis, b)
    if not sa or not sb:
        raise HTTPException(404, detail={"code": "not_found", "message": "One of those scans doesn't exist."})
    base, cur = (sa, sb) if sa.created_at <= sb.created_at else (sb, sa)
    return compare(base, cur)


@router.get("/analysis/{analysis_id}")
def get_analysis(analysis_id: int, db: Session = Depends(get_db)) -> dict:
    a = db.get(Analysis, analysis_id)
    if not a:
        raise HTTPException(404, detail={"code": "not_found", "message": "Scan not found."})
    return analysis_out(a, include_raw=True)


@router.delete("/analysis/{analysis_id}", status_code=204)
def delete_analysis(analysis_id: int, db: Session = Depends(get_db)) -> None:
    a = db.get(Analysis, analysis_id)
    if not a:
        raise HTTPException(404, detail={"code": "not_found", "message": "Scan not found."})
    db.delete(a)
    db.commit()
