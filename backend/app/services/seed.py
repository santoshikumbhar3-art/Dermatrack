"""Curated starter library.

Honesty rules for this data:
* Key actives listed here are ONLY those stated in the product's own name
  (e.g. "Niacinamide 10% + Zinc 1%") or its primary marketing claim. Full INCI
  lists are NOT included and ``ingredients_verified`` is False.
* Prices are NOT included. Prices vary by retailer and region and we have not
  verified them. Users can add a price they have checked themselves.
* Formulations can differ between countries; every record says so.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import LibraryProduct

COMMON_LIMIT = (
    "Key actives are taken from the product name or primary claim only; the full ingredient list has not been "
    "verified here. Formulations and availability vary by country. No price is listed because it has not been verified."
)
SOURCE = "Brand's official product page and packaging (check your region's label before use)."

STARTER_PRODUCTS = [
    dict(name="Hydrating Facial Cleanser", brand="CeraVe", category="cleanser",
         key_actives=[{"name": "ceramides"}, {"name": "hyaluronic acid"}],
         attributes=["gentle-cleanse", "hydration", "barrier-support"], fragrance_free=True,
         instructions="Massage onto damp skin and rinse."),
    dict(name="Gentle Skin Cleanser", brand="Cetaphil", category="cleanser",
         key_actives=[], attributes=["gentle-cleanse"], fragrance_free=True,
         instructions="Apply to skin and rinse, or wipe off without water."),
    dict(name="Moisturising Cream", brand="CeraVe", category="moisturiser",
         key_actives=[{"name": "ceramides"}, {"name": "hyaluronic acid"}],
         attributes=["hydration", "barrier-support"], fragrance_free=True,
         instructions="Apply as often as needed."),
    dict(name="Niacinamide 10% + Zinc 1%", brand="The Ordinary", category="serum",
         key_actives=[{"name": "niacinamide", "concentration_percent": 10}, {"name": "zinc pca", "concentration_percent": 1}],
         attributes=["oil-control", "pore", "tone"], fragrance_free=None,
         instructions="Apply a few drops to the face AM and PM before heavier creams."),
    dict(name="Niacinamide 10% Face Serum", brand="Minimalist", category="serum",
         key_actives=[{"name": "niacinamide", "concentration_percent": 10}],
         attributes=["oil-control", "pore", "tone"], fragrance_free=None,
         instructions="Apply 2–3 drops to clean skin."),
    dict(name="Salicylic Acid 2% Face Serum", brand="Minimalist", category="exfoliant",
         key_actives=[{"name": "salicylic acid", "concentration_percent": 2}],
         attributes=["blemish", "pore", "oil-control", "texture"], fragrance_free=None,
         instructions="Start a few times a week; use sunscreen during the day."),
    dict(name="Skin Perfecting 2% BHA Liquid Exfoliant", brand="Paula's Choice", category="exfoliant",
         key_actives=[{"name": "salicylic acid", "concentration_percent": 2}],
         attributes=["blemish", "pore", "texture"], fragrance_free=True,
         instructions="Apply with a cotton pad or fingertips after cleansing; do not rinse."),
    dict(name="Glycolic Acid 7% Toning Solution", brand="The Ordinary", category="exfoliant",
         key_actives=[{"name": "glycolic acid", "concentration_percent": 7}],
         attributes=["texture", "tone"], fragrance_free=None,
         instructions="Use once daily in the evening; use sunscreen during the day."),
    dict(name="Retinol 0.5% in Squalane", brand="The Ordinary", category="treatment",
         key_actives=[{"name": "retinol", "concentration_percent": 0.5}],
         attributes=["texture", "lines"], fragrance_free=None,
         instructions="Use in the evening. Start a few times a week. Use sunscreen during the day."),
    dict(name="Azelaic Acid Suspension 10%", brand="The Ordinary", category="treatment",
         key_actives=[{"name": "azelaic acid", "concentration_percent": 10}],
         attributes=["tone", "blemish", "texture"], fragrance_free=None,
         instructions="Apply a small amount AM and/or PM after water-based serums."),
    dict(name="Ascorbyl Glucoside Solution 12%", brand="The Ordinary", category="serum",
         key_actives=[{"name": "ascorbyl glucoside", "concentration_percent": 12}],
         attributes=["tone", "radiance"], fragrance_free=None,
         instructions="Apply a few drops AM and/or PM."),
    dict(name="Hyaluronic Acid 2% + B5", brand="The Ordinary", category="serum",
         key_actives=[{"name": "hyaluronic acid", "concentration_percent": 2}],
         attributes=["hydration"], fragrance_free=None,
         instructions="Apply a few drops to damp skin AM and PM."),
    dict(name="Sunscreen SPF 50 PA++++", brand="Minimalist", category="sunscreen",
         key_actives=[{"name": "sunscreen filters"}],
         attributes=["sun-protection"], fragrance_free=None,
         instructions="Apply generously as the last morning step; reapply every 2–3 hours outdoors."),
]


def seed_library(db: Session) -> None:
    exists = db.scalar(select(LibraryProduct.id).where(LibraryProduct.user_added.is_(False)).limit(1))
    if exists:
        return
    for p in STARTER_PRODUCTS:
        db.add(
            LibraryProduct(
                **p,
                full_ingredients=[],
                ingredients_verified=False,
                price=None,
                currency=None,
                price_source="",
                source=SOURCE,
                limitations=COMMON_LIMIT,
                user_added=False,
            )
        )
    db.commit()
