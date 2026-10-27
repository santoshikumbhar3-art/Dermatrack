"""Ingredient Intelligence Engine.

A transparent, deterministic rules engine. No language model is involved in
deciding whether a combination is flagged.

Design principles
-----------------
* Ingredient names are normalised and mapped to *families* (e.g. glycolic acid
  -> AHA) through an explicit synonym table.
* Every rule is a data record with an id, conditions, severity, explanation,
  reference, a cautious next step and its known limitations.
* Severities:
    - ``documented_concern``: the concern appears in product labelling or
      regulatory guidance (e.g. FDA sunburn alert for AHAs).
    - ``precaution``: widely given dermatology guidance about cumulative
      irritation; *not* a prohibition. Many people use these combinations
      successfully, often on alternating days.
    - ``info``: context worth knowing; nothing to change.
    - ``incomplete``: the engine could not evaluate because data is missing.
* Frequency matters: two actives used on different days are reported as
  lower risk than two actives layered in the same application.
* The engine never invents concentrations. Concentration-based checks only run
  when the user entered a concentration.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

# canonical ingredient -> family
FAMILY_OF: dict[str, str] = {}
# synonym -> canonical
SYNONYMS: dict[str, str] = {}
DISPLAY: dict[str, str] = {}


def _register(canonical: str, family: str, display: str, *synonyms: str) -> None:
    FAMILY_OF[canonical] = family
    DISPLAY[canonical] = display
    SYNONYMS[canonical] = canonical
    for s in synonyms:
        SYNONYMS[s] = canonical


# Retinoids
_register("retinol", "retinoid", "Retinol", "vitamin a", "retinol palmitate")
_register("retinal", "retinoid", "Retinal (retinaldehyde)", "retinaldehyde")
_register("retinyl palmitate", "retinoid", "Retinyl palmitate", "retinyl ester")
_register("hydroxypinacolone retinoate", "retinoid", "Hydroxypinacolone retinoate", "hpr", "granactive retinoid")
_register("adapalene", "retinoid", "Adapalene", "differin")
_register("tretinoin", "retinoid", "Tretinoin", "retinoic acid", "retin-a", "all-trans retinoic acid")
_register("tazarotene", "retinoid", "Tazarotene")
# AHAs
_register("glycolic acid", "aha", "Glycolic acid (AHA)", "glycolic")
_register("lactic acid", "aha", "Lactic acid (AHA)", "lactic")
_register("mandelic acid", "aha", "Mandelic acid (AHA)", "mandelic")
_register("citric acid aha", "aha", "Citric acid (AHA)")
_register("aha", "aha", "Alpha hydroxy acid (unspecified)", "alpha hydroxy acid", "alpha hydroxy acids", "ahas")
# BHA
_register("salicylic acid", "bha", "Salicylic acid (BHA)", "salicylic", "bha", "beta hydroxy acid", "betaine salicylate")
# PHA
_register("gluconolactone", "pha", "Gluconolactone (PHA)", "pha", "polyhydroxy acid", "lactobionic acid")
# Others
_register("benzoyl peroxide", "benzoyl_peroxide", "Benzoyl peroxide", "bpo", "benzoyl")
_register("l-ascorbic acid", "vitamin_c_laa", "L-ascorbic acid (vitamin C)", "ascorbic acid", "l ascorbic acid", "vitamin c", "vit c")
_register("ascorbyl glucoside", "vitamin_c_derivative", "Ascorbyl glucoside", "ascorbyl glucoside")
_register("sodium ascorbyl phosphate", "vitamin_c_derivative", "Sodium ascorbyl phosphate", "sap")
_register("magnesium ascorbyl phosphate", "vitamin_c_derivative", "Magnesium ascorbyl phosphate", "map")
_register("ethyl ascorbic acid", "vitamin_c_derivative", "Ethyl ascorbic acid", "3-o-ethyl ascorbic acid")
_register("niacinamide", "niacinamide", "Niacinamide", "nicotinamide", "vitamin b3")
_register("azelaic acid", "azelaic", "Azelaic acid", "azelaic")
_register("hydroquinone", "hydroquinone", "Hydroquinone")
_register("copper peptides", "copper_peptide", "Copper peptides", "copper tripeptide-1", "ghk-cu", "copper peptide")
_register("zinc pca", "zinc", "Zinc PCA", "zinc")
_register("hyaluronic acid", "humectant", "Hyaluronic acid", "sodium hyaluronate", "ha")
_register("ceramides", "barrier_lipid", "Ceramides", "ceramide", "ceramide np", "ceramide ap", "ceramide eop")
_register("sunscreen filters", "sunscreen", "UV filters (sunscreen)", "spf", "sunscreen", "uv filters")
_register("fragrance", "fragrance", "Fragrance (parfum)", "parfum", "perfume")

FAMILY_LABEL = {
    "retinoid": "retinoid",
    "aha": "AHA exfoliant",
    "bha": "BHA exfoliant",
    "pha": "PHA exfoliant",
    "benzoyl_peroxide": "benzoyl peroxide",
    "vitamin_c_laa": "L-ascorbic acid",
    "vitamin_c_derivative": "vitamin C derivative",
    "niacinamide": "niacinamide",
    "azelaic": "azelaic acid",
    "hydroquinone": "hydroquinone",
    "copper_peptide": "copper peptides",
    "zinc": "zinc",
    "humectant": "humectant",
    "barrier_lipid": "barrier lipid",
    "sunscreen": "sunscreen",
    "fragrance": "fragrance",
}

ACID_EXFOLIANTS = {"aha", "bha", "pha"}
IRRITATING_ACTIVES = {"retinoid", "aha", "bha", "benzoyl_peroxide", "vitamin_c_laa", "azelaic", "hydroquinone"}


def normalize_name(raw: str) -> str:
    s = raw.lower().strip()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9\- ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def resolve(raw: str) -> tuple[str | None, str | None]:
    """Return (canonical, family) for an ingredient name, or (None, None) if unknown."""
    n = normalize_name(raw)
    if not n:
        return None, None
    if n in SYNONYMS:
        c = SYNONYMS[n]
        return c, FAMILY_OF[c]
    # Fall back to longest synonym contained as a whole phrase (e.g. "2% salicylic acid serum").
    best = None
    for syn in sorted(SYNONYMS, key=len, reverse=True):
        if len(syn) < 3:
            continue
        if re.search(rf"(?<![a-z]){re.escape(syn)}(?![a-z])", n):
            best = SYNONYMS[syn]
            break
    if best:
        return best, FAMILY_OF[best]
    return None, None


# ---------------------------------------------------------------------------
# Routine model used by the engine
# ---------------------------------------------------------------------------

FREQUENCY_LABEL = {
    "daily": "daily",
    "alternate_days": "alternate days",
    "2_3_week": "2–3× per week",
    "weekly": "weekly",
    "as_needed": "as needed",
}


@dataclass
class EngineActive:
    raw: str
    canonical: str | None
    family: str | None
    concentration: float | None


@dataclass
class EngineProduct:
    id: int | str
    name: str
    slot: str  # am | pm | both
    frequency: str
    instructions: str
    actives: list[EngineActive]
    ingredients_verified: bool
    paused: bool = False

    def families(self) -> set[str]:
        return {a.family for a in self.actives if a.family}

    def slots(self) -> set[str]:
        return {"am", "pm"} if self.slot == "both" else {self.slot}


def build_product(
    id: int | str,
    name: str,
    slot: str,
    frequency: str,
    instructions: str,
    actives: Iterable[dict],
    ingredients_verified: bool,
    paused: bool = False,
) -> EngineProduct:
    out: list[EngineActive] = []
    for a in actives or []:
        raw = str(a.get("name", "")).strip()
        if not raw:
            continue
        canonical, family = resolve(raw)
        conc = a.get("concentration_percent")
        try:
            conc = float(conc) if conc not in (None, "") else None
        except (TypeError, ValueError):
            conc = None
        out.append(EngineActive(raw=raw, canonical=canonical, family=family, concentration=conc))
    # Product names often state the active ("Salicylic Acid 2%"); use that only as a
    # recognised active when the user listed none, and say so via 'inferred_from_name'.
    return EngineProduct(
        id=id,
        name=name,
        slot=slot,
        frequency=frequency or "daily",
        instructions=instructions or "",
        actives=out,
        ingredients_verified=ingredients_verified,
        paused=paused,
    )


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Rule:
    id: str
    title: str
    conditions: str
    severity: str
    explanation: str
    reference: str
    next_step: str
    limitations: str


RULES: dict[str, Rule] = {
    r.id: r
    for r in [
        Rule(
            id="R-RET-ACID-01",
            title="Retinoid and acid exfoliant in the same application",
            conditions="A retinoid and an AHA or BHA are both used in the same slot (AM or PM).",
            severity="precaution",
            explanation=(
                "Retinoids and acid exfoliants can each cause dryness, peeling or stinging. Layering them "
                "in the same application can add up that irritation, especially while the skin is still "
                "adjusting to the retinoid. This is a precaution, not a rule that they can never be combined."
            ),
            reference=(
                "General dermatology guidance on introducing retinoids gradually and limiting other "
                "irritating actives during that period (e.g. American Academy of Dermatology patient education)."
            ),
            next_step=(
                "Consider using them on alternate evenings, or follow the specific instructions on each "
                "product or from your prescriber."
            ),
            limitations=(
                "Does not account for formulation, pH, concentration you have not entered, or skin tolerance "
                "you have already built up."
            ),
        ),
        Rule(
            id="R-BPO-TRET-01",
            title="Benzoyl peroxide with tretinoin",
            conditions="Benzoyl peroxide and tretinoin are applied in the same slot.",
            severity="documented_concern",
            explanation=(
                "Benzoyl peroxide can oxidise and degrade some tretinoin formulations when applied at the "
                "same time, which can make the tretinoin less effective. This is described in tretinoin "
                "labelling for conventional formulations."
            ),
            reference="Tretinoin prescribing information (product labelling); some newer formulations differ.",
            next_step=(
                "Ask your prescriber or pharmacist how they want these timed — commonly one in the morning "
                "and one at night. Do not change a prescribed regimen without advice."
            ),
            limitations="Some formulations (e.g. micronised tretinoin) are designed to be more stable; the engine cannot tell which you use.",
        ),
        Rule(
            id="R-BPO-RET-02",
            title="Benzoyl peroxide with a non-prescription retinoid",
            conditions="Benzoyl peroxide and a retinoid other than tretinoin are applied in the same slot.",
            severity="precaution",
            explanation=(
                "Both are drying. Layering them can increase irritation. Some combination products contain "
                "both on purpose (for example adapalene with benzoyl peroxide), so this is not a prohibition."
            ),
            reference="General dermatology guidance on cumulative irritation from acne actives.",
            next_step="If you notice dryness or stinging, separate them (AM/PM) or reduce frequency.",
            limitations="Does not know whether the products were designed to be used together.",
        ),
        Rule(
            id="R-ACID-STACK-01",
            title="More than one acid exfoliant in the same application",
            conditions="Two or more different products containing AHA, BHA or PHA are used in the same slot.",
            severity="precaution",
            explanation=(
                "Stacking exfoliating acids from different products increases total exfoliation and can "
                "lead to irritation. A single product that contains several acids is formulated for that; "
                "layering separate ones is less predictable."
            ),
            reference="General dermatology guidance on over-exfoliation.",
            next_step="Consider using one acid product per application, or alternating days.",
            limitations="Concentrations and pH are usually not known; gentler acids (PHA, mandelic) tend to be better tolerated.",
        ),
        Rule(
            id="R-VITC-ACID-01",
            title="L-ascorbic acid with an acid exfoliant in the same application",
            conditions="L-ascorbic acid and an AHA or BHA are used in the same slot.",
            severity="precaution",
            explanation=(
                "L-ascorbic acid serums are usually low-pH. Layering them with exfoliating acids can increase "
                "stinging in sensitive skin. Vitamin C derivatives are less likely to cause this."
            ),
            reference="General cosmetic-chemistry and dermatology guidance on low-pH layering.",
            next_step="Many people use vitamin C in the morning and acids at night.",
            limitations="Not a known chemical interaction; the concern is tolerability.",
        ),
        Rule(
            id="R-SUN-01",
            title="Sun-sensitising active without a sunscreen in the routine",
            conditions="The routine contains an AHA or a retinoid but no product recorded as sunscreen.",
            severity="documented_concern",
            explanation=(
                "Alpha hydroxy acids can increase skin's sensitivity to the sun; US FDA guidance asks AHA "
                "cosmetic labels to carry a 'sunburn alert'. Retinoid labelling also commonly advises sun "
                "protection."
            ),
            reference="US FDA, guidance on labelling of cosmetics containing alpha hydroxy acids; retinoid product labelling.",
            next_step="Add a daily broad-spectrum sunscreen to your morning routine, or record the one you already use.",
            limitations="The engine only knows about products you have recorded.",
        ),
        Rule(
            id="R-DUP-01",
            title="Same active family in more than one product in one application",
            conditions="Two products in the same slot share an irritating active family.",
            severity="precaution",
            explanation=(
                "Using two products with the same type of active (for example two retinoid products) at "
                "once increases the total dose in a way that is hard to estimate."
            ),
            reference="General dermatology guidance on avoiding duplicate actives.",
            next_step="Consider keeping one product per active family in each application.",
            limitations="Combination products may be intended to be used together.",
        ),
        Rule(
            id="R-HQ-PEROX-01",
            title="Hydroquinone with benzoyl peroxide",
            conditions="Hydroquinone and benzoyl peroxide are used in the same slot.",
            severity="documented_concern",
            explanation=(
                "Using hydroquinone together with peroxide products can cause temporary dark staining of "
                "the skin, as noted in hydroquinone product labelling."
            ),
            reference="Hydroquinone product labelling (warnings section).",
            next_step="Separate them and follow your prescriber's or pharmacist's instructions.",
            limitations="Hydroquinone availability and labelling vary by country.",
        ),
        Rule(
            id="R-CONC-SAL-01",
            title="Salicylic acid above 2%",
            conditions="A product lists salicylic acid with a concentration above 2%.",
            severity="info",
            explanation=(
                "Over-the-counter acne products in some markets are limited to 0.5–2% salicylic acid. Higher "
                "strengths are typically used as peels, often under professional supervision."
            ),
            reference="US FDA OTC acne drug monograph (0.5–2% salicylic acid).",
            next_step="Check the product's instructions for contact time and frequency.",
            limitations="Leave-on and rinse-off products differ; regional rules differ.",
        ),
        Rule(
            id="R-CONC-AHA-01",
            title="AHA at 10% or higher",
            conditions="An AHA is listed with a concentration of 10% or more.",
            severity="info",
            explanation=(
                "US FDA guidance for cosmetics discusses AHA products at 10% or less for consumer use; higher "
                "strengths are usually short-contact or professional products."
            ),
            reference="US FDA, guidance on alpha hydroxy acids in cosmetics.",
            next_step="Follow the product's directions for contact time and frequency, and use sunscreen.",
            limitations="Final pH strongly affects strength and is rarely known.",
        ),
        Rule(
            id="R-NEW-ACTIVE-01",
            title="Several irritating actives introduced close together",
            conditions="Two or more products with irritating actives were introduced within 14 days of each other.",
            severity="precaution",
            explanation=(
                "Starting several new actives at once makes it hard to tell which one is responsible if your "
                "skin reacts, and increases the chance of irritation."
            ),
            reference="General dermatology guidance to introduce one new active at a time.",
            next_step="If possible, introduce one product at a time and wait a couple of weeks before the next.",
            limitations="Only uses the 'introduced on' dates you entered.",
        ),
        Rule(
            id="R-INCOMPLETE-01",
            title="Product could not be evaluated",
            conditions="A product has no recognised actives recorded.",
            severity="incomplete",
            explanation=(
                "No active ingredients were recorded for this product (or none that the engine recognises), "
                "so combinations involving it could not be fully evaluated."
            ),
            reference="—",
            next_step="Add the key actives from the product's label to include it in compatibility checks.",
            limitations="The engine recognises a fixed list of common actives only.",
        ),
    ]
}

SEVERITY_ORDER = {"documented_concern": 0, "precaution": 1, "info": 2, "incomplete": 3}


@dataclass
class Finding:
    rule_id: str
    severity: str
    title: str
    explanation: str
    reference: str
    next_step: str
    limitations: str
    product_ids: list
    product_names: list[str]
    slot: str | None
    frequency_note: str | None = None
    uncertainty: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "rule_id": self.rule_id,
            "severity": self.severity,
            "title": self.title,
            "explanation": self.explanation,
            "reference": self.reference,
            "next_step": self.next_step,
            "limitations": self.limitations,
            "product_ids": self.product_ids,
            "product_names": self.product_names,
            "slot": self.slot,
            "frequency_note": self.frequency_note,
            "uncertainty": self.uncertainty,
        }


def _make(rule_id: str, products: list[EngineProduct], slot: str | None, **kw) -> Finding:
    r = RULES[rule_id]
    return Finding(
        rule_id=r.id,
        severity=kw.pop("severity", r.severity),
        title=r.title,
        explanation=r.explanation,
        reference=r.reference,
        next_step=r.next_step,
        limitations=r.limitations,
        product_ids=[p.id for p in products],
        product_names=[p.name for p in products],
        slot=slot,
        **kw,
    )


def _overlap_note(a: EngineProduct, b: EngineProduct) -> tuple[str | None, bool]:
    """Return (note, may_not_overlap). If neither product is daily they may be used on different days."""
    if a.frequency != "daily" and b.frequency != "daily":
        return (
            f"Neither product is used daily ({FREQUENCY_LABEL.get(a.frequency, a.frequency)} and "
            f"{FREQUENCY_LABEL.get(b.frequency, b.frequency)}). If you already use them on different days, "
            "this combination may not apply.",
            True,
        )
    return None, False


def _instruction_hints(products: list[EngineProduct]) -> list[str]:
    hints = []
    for p in products:
        t = p.instructions.lower()
        if any(k in t for k in ("alternate", "not with", "do not use with", "avoid using with", "separately")):
            hints.append(f"'{p.name}' has instructions that mention how to combine it: “{p.instructions.strip()[:160]}”.")
    return hints


def evaluate(products: list[EngineProduct], introduced: dict | None = None) -> dict:
    """Evaluate a routine. ``introduced`` maps product id -> date for the new-actives rule."""
    active = [p for p in products if not p.paused]
    findings: list[Finding] = []

    # Incomplete products
    for p in active:
        if not p.families():
            findings.append(_make("R-INCOMPLETE-01", [p], None))

    pair_seen: set[tuple] = set()

    for slot in ("am", "pm"):
        in_slot = [p for p in active if slot in p.slots()]
        for i, a in enumerate(in_slot):
            for b in in_slot[i + 1 :]:
                fa, fb = a.families(), b.families()
                if not fa or not fb:
                    continue
                note, maybe_separate = _overlap_note(a, b)
                hints = _instruction_hints([a, b])
                unc = []
                if not (a.ingredients_verified and b.ingredients_verified):
                    unc.append("Ingredients were entered by hand and have not been verified against the product label.")
                unc.extend(hints)

                def add(rule_id: str, pair=(a, b)):
                    key = (rule_id, tuple(sorted(str(p.id) for p in pair)))
                    if key in pair_seen:
                        return
                    pair_seen.add(key)
                    sev = RULES[rule_id].severity
                    if maybe_separate and sev == "precaution":
                        sev = "info"
                    findings.append(
                        _make(rule_id, list(pair), slot, severity=sev, frequency_note=note, uncertainty=list(unc))
                    )

                canon_a = {x.canonical for x in a.actives}
                canon_b = {x.canonical for x in b.actives}

                # Retinoid + AHA/BHA
                if ("retinoid" in fa and fb & {"aha", "bha"}) or ("retinoid" in fb and fa & {"aha", "bha"}):
                    add("R-RET-ACID-01")
                # BPO + retinoid
                if ("benzoyl_peroxide" in fa and "retinoid" in fb) or ("benzoyl_peroxide" in fb and "retinoid" in fa):
                    if "tretinoin" in canon_a | canon_b:
                        add("R-BPO-TRET-01")
                    else:
                        add("R-BPO-RET-02")
                # Acid stacking across products
                if fa & ACID_EXFOLIANTS and fb & ACID_EXFOLIANTS:
                    add("R-ACID-STACK-01")
                # L-AA + AHA/BHA
                if ("vitamin_c_laa" in fa and fb & {"aha", "bha"}) or ("vitamin_c_laa" in fb and fa & {"aha", "bha"}):
                    add("R-VITC-ACID-01")
                # Hydroquinone + BPO
                if ("hydroquinone" in fa and "benzoyl_peroxide" in fb) or ("hydroquinone" in fb and "benzoyl_peroxide" in fa):
                    add("R-HQ-PEROX-01")
                # Duplicate irritating family
                dup = (fa & fb) & IRRITATING_ACTIVES
                if dup:
                    add("R-DUP-01")

    # Sun protection
    fams_all = set().union(*(p.families() for p in active)) if active else set()
    if fams_all & {"aha", "retinoid"} and "sunscreen" not in fams_all:
        involved = [p for p in active if p.families() & {"aha", "retinoid"}]
        findings.append(_make("R-SUN-01", involved, None))

    # Concentration info (only when the user entered a concentration)
    for p in active:
        for a in p.actives:
            if a.concentration is None:
                continue
            if a.canonical == "salicylic acid" and a.concentration > 2:
                findings.append(_make("R-CONC-SAL-01", [p], None))
            if a.family == "aha" and a.concentration >= 10:
                findings.append(_make("R-CONC-AHA-01", [p], None))

    # Several actives introduced close together
    if introduced:
        dated = sorted(
            [(introduced[p.id], p) for p in active if introduced.get(p.id) and p.families() & IRRITATING_ACTIVES],
            key=lambda t: t[0],
        )
        cluster: list[EngineProduct] = []
        for i, (d, p) in enumerate(dated):
            close = [q for (dq, q) in dated if q is not p and abs((dq - d).days) <= 14]
            if close and p not in cluster:
                cluster.append(p)
        if len(cluster) >= 2:
            findings.append(_make("R-NEW-ACTIVE-01", cluster, None))

    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f.severity, 9), f.rule_id))

    evaluated = [p for p in active if p.families()]
    unrecognised = [
        {"product_id": p.id, "product_name": p.name, "ingredient": a.raw}
        for p in active
        for a in p.actives
        if a.family is None
    ]
    counts = {k: sum(1 for f in findings if f.severity == k) for k in SEVERITY_ORDER}
    return {
        "findings": [f.to_dict() for f in findings],
        "counts": counts,
        "evaluated_products": len(evaluated),
        "total_active_products": len(active),
        "paused_products": len(products) - len(active),
        "unrecognised_ingredients": unrecognised,
        "summary": _summary(findings, len(active), len(evaluated)),
        "disclaimer": (
            "These checks are rule-based and informational. They are not medical advice and do not account "
            "for formulation, pH, prescriptions or your skin's tolerance. Follow product labels and your "
            "clinician's instructions."
        ),
    }


def _summary(findings: list[Finding], total: int, evaluated: int) -> str:
    if total == 0:
        return "No active products in your routine yet."
    dc = sum(1 for f in findings if f.severity == "documented_concern")
    pc = sum(1 for f in findings if f.severity == "precaution")
    inc = total - evaluated
    parts = []
    if dc:
        parts.append(f"{dc} documented concern{'s' if dc > 1 else ''}")
    if pc:
        parts.append(f"{pc} precaution{'s' if pc > 1 else ''}")
    head = ("Found " + " and ".join(parts) + ".") if parts else "No combination concerns found among the products we could evaluate."
    if inc:
        head += f" {inc} product{'s' if inc > 1 else ''} could not be evaluated because no recognised actives are recorded."
    return head


def rules_catalog() -> list[dict]:
    return [r.__dict__ for r in RULES.values()]
