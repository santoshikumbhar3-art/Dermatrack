"""DermaTrack & Adapt — FastAPI backend."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import account, analysis, assistant, products, progress, routines
from .config import settings
from .database import init_db

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="DermaTrack & Adapt API",
    version="1.0.0",
    description="Skin-intelligence backend: YouCam Skin AI integration, progress tracking, ingredient rules and guidance.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.frontend_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    return resp


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    fields = []
    for e in exc.errors():
        loc = ".".join(str(p) for p in e.get("loc", []) if p not in ("body", "query"))
        fields.append({"field": loc, "message": e.get("msg", "Invalid value").removeprefix("Value error, ")})
    msg = fields[0]["message"] if len(fields) == 1 else "Some fields need attention."
    return JSONResponse(status_code=422, content={"detail": {"code": "validation_error", "message": msg, "fields": fields}})


for r in (account.router, analysis.router, routines.router, progress.router, products.router, assistant.router):
    app.include_router(r)


# Serve the built frontend (frontend/dist) if present, so one process can run the whole app.
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": {"code": "not_found", "message": "Unknown API route."}})
        f = DIST / path
        if path and f.is_file() and DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
