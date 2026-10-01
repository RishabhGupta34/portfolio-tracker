from datetime import date, datetime
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.portfolio import load_portfolio, save_portfolio
from services.nav import (
    fetch_mutual_fund_nav,
    search_mutual_fund,
    fetch_stock_price,
    fetch_mutual_fund_holdings,
)

router = APIRouter()


class ManualNavRequest(BaseModel):
    nav: float


@router.get("/api/nav/search/mutual-fund/{fund_name}")
async def search_mutual_fund_endpoint(fund_name: str):
    """Search for mutual fund schemes by name"""
    results = await search_mutual_fund(fund_name)
    return {"results": results}


@router.get("/api/nav/mutual-fund/{scheme_code}")
async def get_mutual_fund_nav(scheme_code: str):
    """Get current NAV for a mutual fund scheme"""
    nav_data = await fetch_mutual_fund_nav(scheme_code)
    if nav_data:
        return nav_data
    raise HTTPException(status_code=404, detail="NAV data not found")


@router.get("/api/nav/stock/{symbol}")
def get_stock_price_endpoint(symbol: str):
    """Get current price for a stock (NSE/BSE)"""
    price_data = fetch_stock_price(symbol)
    if price_data:
        return price_data
    raise HTTPException(status_code=404, detail="Stock price not found")


@router.post("/api/funds/{fund_id}/update-nav")
async def update_fund_current_nav(fund_id: str):
    """Automatically fetch and update current NAV without creating a transaction"""
    portfolio = load_portfolio()
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)

    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    current_nav = None
    nav_date = None

    if fund.type == "mutual_fund":
        if not fund.scheme_code:
            return {
                "message": "Scheme code not set for this fund",
                "note": "Please search and set scheme code when creating the fund",
                "endpoint": f"/api/nav/search/mutual-fund/{fund.name}"
            }
        nav_data = await fetch_mutual_fund_nav(fund.scheme_code)
        if nav_data:
            current_nav = nav_data['nav']
            nav_date = nav_data['date']
    else:
        symbol = fund.symbol or fund.name
        price_data = fetch_stock_price(symbol)
        if price_data:
            current_nav = price_data['price']
            nav_date = date.today().isoformat()

    if current_nav:
        if fund.current_nav:
            fund.previous_nav = fund.current_nav

        fund.current_nav = current_nav
        fund.nav_updated_at = nav_date or date.today().isoformat()
        save_portfolio(portfolio)

        day_change = None
        day_change_pct = None
        if fund.previous_nav:
            day_change = current_nav - fund.previous_nav
            day_change_pct = (day_change / fund.previous_nav) * 100

        return {
            "message": "NAV updated successfully",
            "current_nav": current_nav,
            "previous_nav": fund.previous_nav,
            "day_change": day_change,
            "day_change_pct": day_change_pct,
            "nav_date": nav_date or date.today().isoformat(),
            "fund_name": fund.name
        }

    raise HTTPException(status_code=404, detail="Could not fetch current NAV/price")


@router.post("/api/funds/{fund_id}/manual-nav")
def set_manual_nav(fund_id: str, request: ManualNavRequest):
    """Manually mark a fund's current value (for private shares, gold, illiquid assets)."""
    if request.nav < 0:
        raise HTTPException(status_code=400, detail="NAV must be non-negative")

    portfolio = load_portfolio()
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    if fund.current_nav is not None:
        fund.previous_nav = fund.current_nav
    else:
        fund.previous_nav = request.nav

    fund.current_nav = request.nav
    fund.nav_updated_at = datetime.utcnow().isoformat()
    save_portfolio(portfolio)
    return {
        "message": "Manual NAV updated",
        "current_nav": fund.current_nav,
        "previous_nav": fund.previous_nav,
        "nav_updated_at": fund.nav_updated_at,
    }


@router.get("/api/funds/{fund_id}/holdings")
async def get_fund_holdings(fund_id: str, scheme_code: Optional[str] = None):
    """Get mutual fund portfolio holdings/composition"""
    portfolio = load_portfolio()
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)

    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    if fund.type != "mutual_fund":
        raise HTTPException(status_code=400, detail="Holdings only available for mutual funds")

    if scheme_code:
        holdings = await fetch_mutual_fund_holdings(scheme_code)
        return holdings

    return {
        "message": "Scheme code required",
        "note": "Holdings data requires scheme code. Use search endpoint to find it."
    }
