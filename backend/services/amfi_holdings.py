"""
AMFI monthly portfolio disclosure ingestion — FOUNDATION ONLY.

Background
----------
Yahoo Finance returns only the top ~10 holdings per fund (~50% of AUM). For accurate
fund overlap and sector analysis we need each fund's FULL portfolio, which AMCs are
required to publish monthly. AMFI hosts a hub at:

    https://www.amfiindia.com/research-information/other-data/monthly-portfolio-disclosure

Each AMC publishes its own monthly file in its own format (Excel, PDF, CSV) at its own
URL. There is no single canonical feed. To support every AMC requires a per-AMC parser.

This module provides the SCAFFOLDING:
  - a registry of AMC -> fetcher functions
  - on-disk caching keyed by (AMC, scheme_code, month)
  - one example parser stub for HDFC AMC

Adding a new AMC = implementing one fetcher function and registering it.

NOTE: parsers are not implemented. Calling fetch_full_holdings for an AMC without a
registered parser returns None (and the route returns a clear "not yet supported" error).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from datetime import date
from pathlib import Path
from typing import Callable, Dict, List, Optional

from config import CACHE_DIR


HOLDINGS_CACHE_DIR = CACHE_DIR / "amfi_holdings"
HOLDINGS_CACHE_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class HoldingRow:
    company_name: str
    isin: Optional[str]
    sector: Optional[str]
    weight_percent: float  # share of fund AUM
    market_value: Optional[float] = None  # ₹, if disclosed
    quantity: Optional[float] = None


@dataclass
class FullHoldings:
    amc: str
    scheme_code: str
    scheme_name: str
    as_of_month: str  # YYYY-MM
    total_aum: Optional[float]
    holdings: List[HoldingRow]
    source_url: Optional[str] = None

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["holdings"] = [asdict(h) for h in self.holdings]
        return d


# ----------------------------------------------------------------------
# Per-AMC fetcher registry
# ----------------------------------------------------------------------
# A fetcher is: (scheme_code, month_yyyy_mm) -> Optional[FullHoldings]
# It is responsible for:
#   1. Locating the AMC's monthly disclosure file for the given month
#   2. Downloading and parsing it
#   3. Extracting rows for the given scheme_code
# Implementations not provided here — see README for how to add one.

Fetcher = Callable[[str, str], Optional[FullHoldings]]
_FETCHERS: Dict[str, Fetcher] = {}


def register_amc(amc_key: str):
    """Decorator: register a fetcher for an AMC key (e.g., 'hdfc', 'icici')."""
    def deco(fn: Fetcher) -> Fetcher:
        _FETCHERS[amc_key.lower()] = fn
        return fn
    return deco


# ----------------------------------------------------------------------
# Example stub: HDFC AMC. Real implementation needs to download the Excel
# from amc.hdfcfund.com and parse the monthly portfolio sheet for the
# requested scheme. Left as TODO so the file is honest about its state.
# ----------------------------------------------------------------------
@register_amc("hdfc")
def _fetch_hdfc(scheme_code: str, month: str) -> Optional[FullHoldings]:
    # TODO: download https://www.hdfcfund.com/.../portfolio-disclosure-<MONTH>.xlsx
    # TODO: locate sheet for scheme_code, parse into HoldingRow list.
    return None


# ----------------------------------------------------------------------
# Cache layer
# ----------------------------------------------------------------------

def _cache_path(amc: str, scheme_code: str, month: str) -> Path:
    return HOLDINGS_CACHE_DIR / f"{amc.lower()}_{scheme_code}_{month}.json"


def _load_cached(amc: str, scheme_code: str, month: str) -> Optional[FullHoldings]:
    path = _cache_path(amc, scheme_code, month)
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text())
        rows = [HoldingRow(**r) for r in raw.get("holdings", [])]
        return FullHoldings(
            amc=raw["amc"],
            scheme_code=raw["scheme_code"],
            scheme_name=raw.get("scheme_name", ""),
            as_of_month=raw["as_of_month"],
            total_aum=raw.get("total_aum"),
            holdings=rows,
            source_url=raw.get("source_url"),
        )
    except Exception:
        return None


def _save_cached(holdings: FullHoldings) -> None:
    path = _cache_path(holdings.amc, holdings.scheme_code, holdings.as_of_month)
    path.write_text(json.dumps(holdings.to_dict(), indent=2))


# ----------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------

def list_supported_amcs() -> List[str]:
    return sorted(_FETCHERS.keys())


def detect_amc(fund_house: Optional[str]) -> Optional[str]:
    """Best-effort AMC key detection from the AMFI fund_house name."""
    if not fund_house:
        return None
    fh = fund_house.lower()
    aliases = {
        "hdfc": ["hdfc"],
        "icici": ["icici"],
        "sbi": ["sbi"],
        "axis": ["axis"],
        "kotak": ["kotak"],
        "nippon": ["nippon"],
        "mirae": ["mirae"],
        "uti": ["uti"],
        "aditya_birla": ["aditya birla", "absl", "birla"],
        "dsp": ["dsp"],
        "tata": ["tata"],
        "parag": ["parag"],
        "edelweiss": ["edelweiss"],
        "quant": ["quant"],
    }
    for key, needles in aliases.items():
        if any(n in fh for n in needles):
            return key
    return None


def fetch_full_holdings(
    scheme_code: str,
    fund_house: Optional[str],
    month: Optional[str] = None,
) -> Optional[FullHoldings]:
    """
    Try to fetch full monthly portfolio for a fund. Returns None if no parser is
    registered for the AMC, or if the parser couldn't find the month's file.

    Args:
        scheme_code: AMFI scheme code
        fund_house: AMFI fund_house string (used to detect AMC)
        month: YYYY-MM; defaults to last month (most recent disclosure available)
    """
    amc = detect_amc(fund_house)
    if not amc or amc not in _FETCHERS:
        return None

    if month is None:
        today = date.today()
        # Most recent disclosure is for the prior calendar month
        prev = today.replace(day=1)
        # Step back one month
        if prev.month == 1:
            prev = prev.replace(year=prev.year - 1, month=12)
        else:
            prev = prev.replace(month=prev.month - 1)
        month = prev.strftime("%Y-%m")

    cached = _load_cached(amc, scheme_code, month)
    if cached is not None:
        return cached

    fetched = _FETCHERS[amc](scheme_code, month)
    if fetched is not None:
        _save_cached(fetched)
    return fetched
