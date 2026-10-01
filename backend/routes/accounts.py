from datetime import datetime
from fastapi import APIRouter, HTTPException
from models import Account, CreateAccountRequest
from services.portfolio import load_portfolio, save_portfolio
from services.metrics import calculate_account_metrics

router = APIRouter()


@router.get("/api/accounts")
def get_accounts():
    """Get all accounts"""
    portfolio = load_portfolio()
    return portfolio.accounts


@router.post("/api/accounts")
def create_account(request: CreateAccountRequest):
    """Create a new account"""
    portfolio = load_portfolio()

    account_id = f"acc_{len(portfolio.accounts) + 1}_{datetime.now().timestamp()}"

    new_account = Account(
        id=account_id,
        name=request.name,
        description=request.description
    )

    portfolio.accounts.append(new_account)
    save_portfolio(portfolio)

    return new_account


@router.get("/api/metrics/account/{account_id}")
def get_account_metrics(account_id: str):
    """Get metrics for a specific account"""
    portfolio = load_portfolio()

    account = next((a for a in portfolio.accounts if a.id == account_id), None)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    metrics = calculate_account_metrics(account_id, portfolio.funds)
    return metrics
