from datetime import datetime
from fastapi import APIRouter, HTTPException
from models import Transaction, AddTransactionRequest
from services.portfolio import load_portfolio, save_portfolio

router = APIRouter()


@router.post("/api/transactions")
def add_transaction(request: AddTransactionRequest):
    """Add a transaction to a fund"""
    portfolio = load_portfolio()

    fund = next((f for f in portfolio.funds if f.id == request.fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    txn_id = f"txn_{len(fund.transactions) + 1}_{datetime.now().timestamp()}"

    if request.transaction_type in ['bonus', 'split']:
        amount = 0
    else:
        amount = request.units * request.nav

    split_nav = request.nav
    if request.transaction_type == 'split' and request.split_ratio:
        try:
            old_shares, new_shares = map(int, request.split_ratio.split(':'))
            multiplier = new_shares / old_shares

            total_units_before = 0
            total_invested = 0

            for txn in fund.transactions:
                if txn.date < request.date:
                    if txn.transaction_type == 'buy' or txn.transaction_type == 'bonus':
                        total_units_before += txn.units
                        total_invested += txn.amount
                    elif txn.transaction_type == 'sell':
                        total_units_before -= txn.units
                        total_invested -= txn.amount

            if total_units_before > 0:
                avg_nav_before = total_invested / total_units_before
                split_nav = avg_nav_before / multiplier

            for txn in fund.transactions:
                if txn.date < request.date and txn.transaction_type in ['buy', 'sell', 'bonus']:
                    txn.units = txn.units * multiplier
                    txn.nav = txn.nav / multiplier
        except Exception as e:
            print(f"Error processing split: {e}")

    new_transaction = Transaction(
        id=txn_id,
        date=request.date,
        units=request.units,
        nav=split_nav,
        amount=amount,
        transaction_type=request.transaction_type,
        split_ratio=request.split_ratio,
        notes=request.notes,
        # ESOP / RSU passthrough — these are already in INR (frontend converts before sending)
        strike_price=request.strike_price,
        fmv=request.fmv,
        perquisite_tax=request.perquisite_tax,
        original_currency=request.original_currency,
        original_nav=request.original_nav,
        original_strike_price=request.original_strike_price,
        original_fmv=request.original_fmv,
        fx_rate=request.fx_rate,
        fx_rate_source=request.fx_rate_source,
    )

    fund.transactions.append(new_transaction)
    fund.transactions.sort(key=lambda x: x.date)

    save_portfolio(portfolio)

    return new_transaction


@router.delete("/api/transactions/{fund_id}/{transaction_id}")
def delete_transaction(fund_id: str, transaction_id: str):
    """Delete a transaction"""
    portfolio = load_portfolio()

    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    fund.transactions = [t for t in fund.transactions if t.id != transaction_id]
    save_portfolio(portfolio)

    return {"message": "Transaction deleted successfully"}
