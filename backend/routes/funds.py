from datetime import datetime
from fastapi import APIRouter, HTTPException
from models import Fund, CreateFundRequest, UpdateFundRequest
from services.portfolio import load_portfolio, save_portfolio
from services.metrics import calculate_fund_metrics
from services.amfi_holdings import (
    fetch_full_holdings, list_supported_amcs, detect_amc,
)
from services.nav import fetch_mutual_fund_nav

router = APIRouter()


@router.get("/api/funds")
def get_funds():
    """Get all funds"""
    portfolio = load_portfolio()
    return portfolio.funds


@router.get("/api/funds/{fund_id}")
def get_fund(fund_id: str):
    """Get a specific fund with its metrics"""
    portfolio = load_portfolio()
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)

    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    metrics = calculate_fund_metrics(fund)

    return {
        "fund": fund,
        "metrics": metrics
    }


@router.post("/api/funds")
def create_fund(request: CreateFundRequest):
    """Create a new fund"""
    portfolio = load_portfolio()

    account = next((a for a in portfolio.accounts if a.id == request.account_id), None)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    fund_id = f"fund_{len(portfolio.funds) + 1}_{datetime.now().timestamp()}"

    new_fund = Fund(
        id=fund_id,
        name=request.name,
        type=request.type,
        account_id=request.account_id,
        transactions=[],
        scheme_code=request.scheme_code,
        symbol=request.symbol,
        interest_rate=request.interest_rate,
        maturity_date=request.maturity_date,
        bank=request.bank,
        principal=request.principal,
        start_date=request.start_date,
        ppf_account_number=request.ppf_account_number,
        # ESOP/RSU grant-level passthrough
        esop_grant_type=request.esop_grant_type,
        esop_company=request.esop_company,
        esop_currency=request.esop_currency,
        esop_grant_date=request.esop_grant_date,
        esop_total_units=request.esop_total_units,
        esop_vesting_schedule=request.esop_vesting_schedule,
    )

    portfolio.funds.append(new_fund)
    save_portfolio(portfolio)

    return new_fund


@router.put("/api/funds/{fund_id}")
def update_fund(fund_id: str, request: UpdateFundRequest):
    """Update editable fund fields. Transactions/NAV state are not touched."""
    portfolio = load_portfolio()

    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    if request.account_id is not None:
        if not any(a.id == request.account_id for a in portfolio.accounts):
            raise HTTPException(status_code=400, detail="Account not found")

    update_fields = request.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(fund, field, value)

    save_portfolio(portfolio)
    return fund


@router.delete("/api/funds/{fund_id}")
def delete_fund(fund_id: str):
    """Delete a fund/investment"""
    portfolio = load_portfolio()

    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    portfolio.funds = [f for f in portfolio.funds if f.id != fund_id]
    save_portfolio(portfolio)

    return {"message": "Investment deleted successfully"}


@router.get("/api/metrics/fund/{fund_id}")
def get_fund_metrics_endpoint(fund_id: str):
    """Get metrics for a specific fund"""
    portfolio = load_portfolio()

    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    metrics = calculate_fund_metrics(fund)
    return metrics


@router.get("/api/funds/holdings/supported-amcs")
def get_supported_amcs():
    """Which AMCs we can fetch full monthly holdings for (from AMFI disclosures)."""
    return {"supported": list_supported_amcs()}


@router.get("/api/funds/{fund_id}/full-holdings")
async def get_full_holdings(fund_id: str, month: str | None = None):
    """
    Fetch the full monthly portfolio disclosure for a mutual fund (every holding,
    not just the top 10 from Yahoo). Requires that we have a parser registered for
    the fund's AMC — see services/amfi_holdings.py.

    Returns 503 with an explanatory message if the AMC isn't supported yet.
    """
    portfolio = load_portfolio()
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")
    if fund.type != "mutual_fund" or not fund.scheme_code:
        raise HTTPException(status_code=400, detail="Full holdings are only available for mutual funds with an AMFI scheme code.")

    # MFAPI's /mf/<scheme_code> endpoint exposes fund_house on `meta`. We need it to
    # pick the right AMC parser; the existing nav helpers only return scheme_name.
    import httpx
    fund_house = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"https://api.mfapi.in/mf/{fund.scheme_code}")
            if resp.status_code == 200:
                fund_house = resp.json().get("meta", {}).get("fund_house")
    except Exception:
        pass

    amc_key = detect_amc(fund_house)
    if not amc_key or amc_key not in list_supported_amcs():
        raise HTTPException(
            status_code=503,
            detail={
                "error": "AMC not yet supported",
                "fund_house": fund_house,
                "supported_amcs": list_supported_amcs(),
                "message": "Add a parser in services/amfi_holdings.py to enable this AMC.",
            },
        )

    holdings = fetch_full_holdings(fund.scheme_code, fund_house, month)
    if holdings is None:
        raise HTTPException(
            status_code=502,
            detail="Parser registered but could not fetch/parse the disclosure for this month.",
        )
    return holdings.to_dict()
