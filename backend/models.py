from typing import Optional, List
from pydantic import BaseModel


class Transaction(BaseModel):
    id: str
    date: str  # ISO format date
    units: float
    nav: float  # Always in INR (post-conversion if originally in foreign currency)
    amount: float  # Always in INR
    transaction_type: str  # "buy", "sell", "bonus", "split", "vest" (for ESOP/RSU)
    split_ratio: Optional[str] = None  # For splits: "1:2" means 1 becomes 2
    notes: Optional[str] = None

    # ─── ESOP / RSU specific fields ──────────────────────────────────
    # All monetary fields are stored in INR (post-conversion). The original
    # currency + amount are preserved alongside so the user can edit them
    # later or see the source numbers in the UI.
    strike_price: Optional[float] = None       # Exercise price per share (₹0 for RSUs). INR.
    fmv: Optional[float] = None                # Fair Market Value per share at vest/grant. INR.
    perquisite_tax: Optional[float] = None     # TDS / perquisite tax paid at vest/exercise. INR.
    original_currency: Optional[str] = None    # e.g. "USD", "EUR" — the currency the company paid in.
    original_nav: Optional[float] = None       # NAV/price in original currency, pre-conversion.
    original_strike_price: Optional[float] = None
    original_fmv: Optional[float] = None
    fx_rate: Optional[float] = None            # FX rate used at the time of conversion (1 unit of original_currency → INR).
    fx_rate_source: Optional[str] = None       # "yahoo" / "manual" / "cache" / "fallback"

    # ─── ESOP / RSU – pricing / tax extras ───────────────────────────
    estimated_price: Optional[float] = None    # IPO / pre-IPO estimated price per share (INR) for visualization only
    original_estimated_price: Optional[float] = None  # In original currency, if foreign
    tax_input_type: Optional[str] = None       # "amount" | "percent" — how the user entered tax
    tax_input_value: Optional[float] = None    # raw input (percent or INR amount, whichever user typed)


class Fund(BaseModel):
    id: str
    name: str
    type: str  # "mutual_fund", "stock", "private_share", "esop", "fd", "ppf", "epf", "gold", "other"
    account_id: str
    transactions: List[Transaction]
    scheme_code: Optional[str] = None
    symbol: Optional[str] = None
    current_nav: Optional[float] = None
    previous_nav: Optional[float] = None
    nav_updated_at: Optional[str] = None
    interest_rate: Optional[float] = None
    maturity_date: Optional[str] = None
    bank: Optional[str] = None
    principal: Optional[float] = None
    start_date: Optional[str] = None
    maturity_value: Optional[float] = None
    ppf_account_number: Optional[str] = None

    # ─── FD break fields ─────────────────────────────────────────────
    fd_broken: Optional[bool] = None            # True if FD was broken pre-maturity
    fd_broken_date: Optional[str] = None        # Date the FD was broken (ISO)
    fd_broken_amount: Optional[float] = None    # Actual amount received on breaking

    # ─── ESOP / RSU grant-level fields ───────────────────────────────
    esop_grant_type: Optional[str] = None      # "esop" or "rsu"
    esop_company: Optional[str] = None         # Company ticker / name (e.g. "GOOG", "MSFT")
    esop_currency: Optional[str] = None        # Default currency for grant entries ("USD", "INR", ...)
    esop_grant_date: Optional[str] = None      # ISO date of the original grant
    esop_total_units: Optional[float] = None   # Total units in the grant (optional, for vesting tracking)
    esop_vesting_schedule: Optional[str] = None  # Free-form: e.g. "25% after 1y, then quarterly"


class Account(BaseModel):
    id: str
    name: str
    description: Optional[str] = None


class Portfolio(BaseModel):
    accounts: List[Account]
    funds: List[Fund]


class AddTransactionRequest(BaseModel):
    fund_id: str
    date: str
    units: float
    nav: float
    transaction_type: str
    split_ratio: Optional[str] = None
    notes: Optional[str] = None

    # ESOP/RSU
    strike_price: Optional[float] = None
    fmv: Optional[float] = None
    perquisite_tax: Optional[float] = None
    original_currency: Optional[str] = None
    original_nav: Optional[float] = None
    original_strike_price: Optional[float] = None
    original_fmv: Optional[float] = None
    fx_rate: Optional[float] = None
    fx_rate_source: Optional[str] = None

    # ESOP – pricing / tax extras
    estimated_price: Optional[float] = None
    original_estimated_price: Optional[float] = None
    tax_input_type: Optional[str] = None
    tax_input_value: Optional[float] = None


class CreateFundRequest(BaseModel):
    name: str
    type: str
    account_id: str
    scheme_code: Optional[str] = None
    symbol: Optional[str] = None
    interest_rate: Optional[float] = None
    maturity_date: Optional[str] = None
    bank: Optional[str] = None
    principal: Optional[float] = None
    start_date: Optional[str] = None
    ppf_account_number: Optional[str] = None

    # ESOP/RSU grant-level
    esop_grant_type: Optional[str] = None
    esop_company: Optional[str] = None
    esop_currency: Optional[str] = None
    esop_grant_date: Optional[str] = None
    esop_total_units: Optional[float] = None
    esop_vesting_schedule: Optional[str] = None


class CreateAccountRequest(BaseModel):
    name: str
    description: Optional[str] = None


class UpdateFundRequest(BaseModel):
    name: Optional[str] = None
    account_id: Optional[str] = None
    scheme_code: Optional[str] = None
    symbol: Optional[str] = None
    interest_rate: Optional[float] = None
    maturity_date: Optional[str] = None
    bank: Optional[str] = None
    principal: Optional[float] = None
    start_date: Optional[str] = None
    ppf_account_number: Optional[str] = None

    # ESOP/RSU grant-level
    esop_grant_type: Optional[str] = None
    esop_company: Optional[str] = None
    esop_currency: Optional[str] = None
    esop_grant_date: Optional[str] = None
    esop_total_units: Optional[float] = None
    esop_vesting_schedule: Optional[str] = None
