"""Application configuration, loaded from environment variables.

Secrets (the YouCam API key, an optional LLM key) live only on the server.
They are never returned by any endpoint and never sent to the browser.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    # --- YouCam Skin AI (official docs: https://docs.perfectcorp.com/reference/ai_skin_analysis) ---
    youcam_api_key: str = field(default_factory=lambda: os.getenv("YOUCAM_API_KEY", "").strip())
    youcam_base_url: str = field(
        default_factory=lambda: os.getenv("YOUCAM_BASE_URL", "https://yce-api-01.makeupar.com").rstrip("/")
    )
    # "sd" or "hd". SD and HD concerns cannot be mixed in one request, and scores
    # from the two modes are not compared with each other in progress tracking.
    youcam_mode: str = field(default_factory=lambda: os.getenv("YOUCAM_MODE", "sd").strip().lower())
    youcam_poll_interval_s: float = field(
        default_factory=lambda: float(os.getenv("YOUCAM_POLL_INTERVAL_S", "2.5"))
    )
    youcam_timeout_s: int = field(default_factory=lambda: _int("YOUCAM_TIMEOUT_S", 120))

    # Development-only fixture. Used ONLY when no API key is configured AND this
    # flag is on. Fixture results are labelled "dev_fixture" everywhere in the UI
    # and are never used as a fallback when a live request fails.
    dev_fixture_enabled: bool = field(default_factory=lambda: _bool("DEV_FIXTURE_ENABLED", True))

    # Store a redacted copy of the provider response (signed URLs removed) for debugging.
    store_redacted_raw_response: bool = field(
        default_factory=lambda: _bool("STORE_REDACTED_RAW_RESPONSE", True)
    )

    # --- Optional LLM for the companion's phrasing (never for safety decisions) ---
    anthropic_api_key: str = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", "").strip())
    assistant_llm_model: str = field(
        default_factory=lambda: os.getenv("ASSISTANT_LLM_MODEL", "claude-sonnet-5-5")
    )

    # --- App ---
    database_url: str = field(
        default_factory=lambda: os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'dermatrack.db'}")
    )
    frontend_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.getenv(
                "FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",")
            if o.strip()
        )
    )
    max_upload_bytes: int = field(default_factory=lambda: _int("MAX_UPLOAD_BYTES", 10 * 1024 * 1024 - 1))

    @property
    def youcam_configured(self) -> bool:
        return bool(self.youcam_api_key)

    @property
    def analysis_source(self) -> str:
        """Which analysis path a new scan will take: 'youcam' | 'dev_fixture' | 'unavailable'."""
        if self.youcam_configured:
            return "youcam"
        if self.dev_fixture_enabled:
            return "dev_fixture"
        return "unavailable"

    @property
    def min_short_side(self) -> int:
        # From YouCam "File Specs & Errors": SD >= 480px, HD >= 1080px on the short side.
        return 1080 if self.youcam_mode == "hd" else 480


settings = Settings()
