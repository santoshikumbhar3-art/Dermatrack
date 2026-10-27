from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import AssistantIn
from ..services.assistant_service import answer, assistant_status

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.get("/status")
def status() -> dict:
    return assistant_status()


@router.post("/message")
async def message(body: AssistantIn, db: Session = Depends(get_db)) -> dict:
    return await answer(db, body.message.strip())
