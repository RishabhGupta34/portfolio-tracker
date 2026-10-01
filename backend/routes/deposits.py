import uuid
from datetime import datetime, date
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from config import INDIAN_BANKS
from models import Transaction
from services.portfolio import load_portfolio, save_portfolio

router = APIRouter()


class BreakFDRequest(BaseModel):
    break_date: str
    actual_amount: float


@router.post("/api/funds/{fund_id}/break-fd")
def break_fd(fund_id: str, request: BreakFDRequest):
    """Record a pre-maturity FD break with the actual amount received"""
    portfolio = load_portfolio()
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")
    if fund.type != 'fd':
        raise HTTPException(status_code=400, detail="Only FD type can be broken")
    if not fund.principal:
        raise HTTPException(status_code=400, detail="FD principal not set")

    fund.fd_broken = True
    fund.fd_broken_date = request.break_date
    fund.fd_broken_amount = request.actual_amount

    # Update maturity_value to the actual received amount so the summary cards reflect reality
    fund.maturity_value = request.actual_amount
    save_portfolio(portfolio)

    interest = request.actual_amount - fund.principal
    days = 0
    if fund.start_date:
        days = (datetime.fromisoformat(request.break_date) - datetime.fromisoformat(fund.start_date)).days
    effective_pct = (interest / fund.principal * 100) if fund.principal else 0

    return {
        "principal": round(fund.principal, 2),
        "actual_amount": round(request.actual_amount, 2),
        "interest_earned": round(interest, 2),
        "effective_pct": round(effective_pct, 4),
        "days_held": days,
    }


@router.get("/api/banks")
def get_banks():
    """Get list of Indian banks"""
    return {"banks": INDIAN_BANKS}


@router.post("/api/funds/{fund_id}/calculate-fd-maturity")
def calculate_fd_maturity(fund_id: str):
    """Calculate FD maturity value"""
    portfolio = load_portfolio()

    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    if fund.type != 'fd':
        raise HTTPException(status_code=400, detail="Only for FD type")

    if not fund.principal or not fund.interest_rate or not fund.start_date or not fund.maturity_date:
        raise HTTPException(status_code=400, detail="Missing FD details (principal, rate, dates)")

    start = datetime.fromisoformat(fund.start_date)
    maturity = datetime.fromisoformat(fund.maturity_date)
    days = (maturity - start).days
    years = days / 365

    principal = fund.principal
    rate = fund.interest_rate / 100

    # Compound interest with quarterly compounding: A = P * (1 + r/n)^(n*t)
    n = 4
    maturity_value = principal * ((1 + rate/n) ** (n * years))
    interest = maturity_value - principal

    fund.maturity_value = maturity_value
    save_portfolio(portfolio)

    return {
        "principal": round(principal, 2),
        "interest_rate": fund.interest_rate,
        "tenure_days": days,
        "tenure_years": round(years, 2),
        "interest_earned": round(interest, 2),
        "maturity_value": round(maturity_value, 2)
    }


@router.post("/api/funds/{fund_id}/calculate-interest")
def calculate_interest(fund_id: str):
    """Calculate and add interest for PPF/FD/EPF type investments"""
    portfolio = load_portfolio()

    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    if fund.type not in ['ppf', 'fd', 'epf']:
        raise HTTPException(status_code=400, detail="Interest calculation only available for PPF/FD/EPF")

    if not fund.interest_rate:
        raise HTTPException(status_code=400, detail="Interest rate not set for this fund")

    total_principal = sum(t.amount for t in fund.transactions if t.transaction_type == 'buy')

    if total_principal == 0:
        raise HTTPException(status_code=400, detail="No deposits found")

    annual_rate = fund.interest_rate / 100

    if fund.type == 'ppf':
        interest = total_principal * annual_rate
    elif fund.type == 'fd':
        interest = total_principal * annual_rate
    else:  # epf
        interest = total_principal * annual_rate

    today = date.today().isoformat()

    interest_transaction = Transaction(
        id=str(uuid.uuid4()),
        date=today,
        transaction_type='buy',
        units=interest,
        nav=1.0,
        amount=interest
    )

    fund.transactions.append(interest_transaction)
    save_portfolio(portfolio)

    return {
        "message": "Interest calculated and added",
        "interest_amount": round(interest, 2),
        "transaction_id": interest_transaction.id
    }
