from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Profile


def get_profile(db: Session) -> Profile:
    """Single-user prototype: profile row id=1 is created on first use."""
    p = db.get(Profile, 1)
    if p is None:
        p = Profile(id=1)
        db.add(p)
        db.commit()
    return p
