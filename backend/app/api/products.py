from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import LibraryProduct
from ..schemas import LibraryProductIn
from ..services.recommendation_service import _lp_dict, recommend

router = APIRouter(prefix="/api", tags=["products"])


@router.get("/products")
def list_products(category: str | None = None, db: Session = Depends(get_db)) -> list[dict]:
    q = select(LibraryProduct).order_by(LibraryProduct.category, LibraryProduct.brand, LibraryProduct.name)
    if category:
        q = q.where(LibraryProduct.category == category)
    return [_lp_dict(p) for p in db.scalars(q)]


@router.post("/products", status_code=201)
def add_product(body: LibraryProductIn, db: Session = Depends(get_db)) -> dict:
    data = body.model_dump()
    if data["price"] is not None and not data["currency"]:
        raise HTTPException(422, detail={"code": "currency_required", "message": "Add a currency for the price."})
    p = LibraryProduct(
        **{**data, "key_actives": [a for a in data["key_actives"]]},
        full_ingredients=[],
        ingredients_verified=False,
        limitations="Added by you. DermaTrack has not verified this product's details.",
        user_added=True,
    )
    if data["price"] is not None and not data["price_source"]:
        p.price_source = "Entered by you"
    db.add(p)
    db.commit()
    return _lp_dict(p)


@router.delete("/products/{product_id}", status_code=204)
def delete_product(product_id: int, db: Session = Depends(get_db)) -> None:
    p = db.get(LibraryProduct, product_id)
    if not p:
        raise HTTPException(404, detail={"code": "not_found", "message": "Product not found."})
    if not p.user_added:
        raise HTTPException(403, detail={"code": "curated", "message": "Curated library products can't be deleted."})
    db.delete(p)
    db.commit()


@router.get("/products/recommendations")
def recommendations(category: str | None = None, db: Session = Depends(get_db)) -> dict:
    return recommend(db, category)
