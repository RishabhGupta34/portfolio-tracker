import math
from datetime import datetime, date
from fastapi import APIRouter
from services.portfolio import load_portfolio
from services.metrics import calculate_fund_metrics, calculate_account_metrics, calculate_xirr
from services.nav import fetch_mutual_fund_historical_nav, fetch_stock_historical_prices

router = APIRouter()


@router.get("/api/charts/portfolio-timeline")
async def get_portfolio_timeline(account_id: str = None, fund_type: str = None):
    """Get portfolio value over time for charting (excludes FD/PPF/EPF)"""
    portfolio = load_portfolio()

    if not portfolio.funds:
        return {"timeline": []}

    filtered_funds = [f for f in portfolio.funds if f.type not in ['fd', 'ppf', 'epf']]
    if account_id and account_id != 'all':
        filtered_funds = [f for f in filtered_funds if f.account_id == account_id]
    if fund_type and fund_type != 'all':
        filtered_funds = [f for f in filtered_funds if f.type == fund_type]

    if not filtered_funds:
        return {"timeline": []}

    all_dates = set()
    for fund in filtered_funds:
        for txn in fund.transactions:
            all_dates.add(txn.date)

    if not all_dates:
        return {"timeline": []}

    today = date.today().isoformat()
    all_dates.add(today)

    sorted_dates = sorted(list(all_dates))
    first_date = datetime.fromisoformat(sorted_dates[0]).date()
    last_date = datetime.fromisoformat(sorted_dates[-1]).date()

    sample_dates = set(sorted_dates)

    current = first_date
    while current <= last_date:
        sample_dates.add(current.isoformat())
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1, day=1)
        else:
            current = current.replace(month=current.month + 1, day=1)

    sorted_dates = sorted(list(sample_dates))

    print("Fetching historical NAV data...")
    historical_data = {}
    for fund in filtered_funds:
        if fund.type == 'mutual_fund' and fund.scheme_code:
            historical_data[fund.id] = await fetch_mutual_fund_historical_nav(fund.scheme_code, fund.id)
        elif fund.type == 'stock' and fund.symbol:
            historical_data[fund.id] = fetch_stock_historical_prices(fund.symbol, first_date.isoformat(), fund.id)

    print(f"Fetched/cached historical data for {len(historical_data)} funds")

    timeline = []
    for target_date in sorted_dates:
        total_invested = 0
        total_value = 0
        all_transactions_to_date = []

        for fund in filtered_funds:
            relevant_txns = [t for t in fund.transactions if t.date <= target_date]
            if not relevant_txns:
                continue

            invested = 0
            units = 0
            for txn in relevant_txns:
                if txn.transaction_type in ["buy", "bonus"]:
                    invested += txn.amount
                    units += txn.units
                elif txn.transaction_type == "sell":
                    if units > 0:
                        invested -= (txn.units / units) * invested
                    units -= txn.units

            if units <= 0:
                continue

            all_transactions_to_date.extend(relevant_txns)

            latest_nav = None
            if fund.id in historical_data:
                if target_date in historical_data[fund.id]:
                    latest_nav = historical_data[fund.id][target_date]
                else:
                    available_dates = sorted([d for d in historical_data[fund.id].keys() if d <= target_date])
                    if available_dates:
                        latest_nav = historical_data[fund.id][available_dates[-1]]

            if latest_nav is None and target_date == today and fund.current_nav is not None:
                latest_nav = fund.current_nav

            if latest_nav is None:
                latest_nav = relevant_txns[-1].nav

            current_value = units * latest_nav

            total_invested += invested
            total_value += current_value

        xirr = None
        if all_transactions_to_date and total_value > 0:
            all_transactions_to_date.sort(key=lambda x: x.date)
            xirr = calculate_xirr(all_transactions_to_date, total_value, target_date)

        timeline.append({
            "date": target_date,
            "invested": round(total_invested, 2),
            "value": round(total_value, 2),
            "returns": round(total_value - total_invested, 2),
            "returns_pct": round((total_value - total_invested) / total_invested * 100, 2) if total_invested > 0 else 0,
            "xirr": round(xirr, 2) if xirr is not None and not math.isnan(xirr) and not math.isinf(xirr) else None
        })

    return {"timeline": timeline}


@router.get("/api/charts/account-allocation")
def get_account_allocation():
    """Get account-wise allocation for pie chart (excludes FD/PPF/EPF)"""
    portfolio = load_portfolio()

    allocations = []
    for account in portfolio.accounts:
        account_funds = [f for f in portfolio.funds if f.account_id == account.id and f.type not in ['fd', 'ppf', 'epf']]
        metrics = calculate_account_metrics(account.id, account_funds)
        if metrics['current_value'] > 0:
            allocations.append({
                "name": account.name,
                "value": metrics['current_value'],
                "invested": metrics['total_invested'],
                "returns": metrics['absolute_return']
            })

    return {"allocations": allocations}


@router.get("/api/charts/fund-performance")
def get_fund_performance():
    """Get fund-wise performance comparison for bar chart (excludes FD/PPF/EPF)"""
    portfolio = load_portfolio()

    performances = []
    for fund in portfolio.funds:
        if fund.type in ['fd', 'ppf', 'epf']:
            continue

        metrics = calculate_fund_metrics(fund)
        if metrics['total_invested'] > 0 and metrics['current_units'] > 0:
            performances.append({
                "name": fund.name,
                "invested": metrics['total_invested'],
                "current_value": metrics['current_value'],
                "returns": metrics['absolute_return'],
                "returns_pct": metrics['absolute_return_pct'],
                "xirr": metrics['xirr'],
                "type": fund.type
            })

    performances.sort(key=lambda x: x['returns_pct'], reverse=True)

    return {"performances": performances}


@router.get("/api/charts/asset-type-allocation")
def get_asset_type_allocation():
    """Get allocation by asset type (excludes FD/PPF/EPF)"""
    portfolio = load_portfolio()

    allocation = {}

    for fund in portfolio.funds:
        if fund.type in ['fd', 'ppf', 'epf']:
            continue

        if fund.type not in allocation:
            allocation[fund.type] = {"value": 0, "invested": 0, "count": 0}

        metrics = calculate_fund_metrics(fund)
        if metrics['total_invested'] > 0:
            allocation[fund.type]["value"] += metrics['current_value']
            allocation[fund.type]["invested"] += metrics['total_invested']
            allocation[fund.type]["count"] += 1

    type_names = {
        "mutual_fund": "Mutual Funds",
        "stock": "Stocks",
        "gold": "Gold/Silver",
        "other": "Other"
    }

    result = []
    for asset_type, data in allocation.items():
        if data['value'] > 0:
            result.append({
                "name": type_names.get(asset_type, asset_type.replace('_', ' ').title()),
                "value": round(data['value'], 2),
                "invested": round(data['invested'], 2),
                "returns": round(data['value'] - data['invested'], 2),
                "count": data['count']
            })

    return {"allocations": result}


@router.get("/api/charts/top-performers")
def get_top_performers():
    """Get top 5 best and worst performing funds (excludes FD/PPF/EPF)"""
    portfolio = load_portfolio()

    performances = []
    for fund in portfolio.funds:
        if fund.type in ['fd', 'ppf', 'epf']:
            continue

        metrics = calculate_fund_metrics(fund)
        if metrics['total_invested'] > 0:
            performances.append({
                "name": fund.name,
                "returns_pct": metrics['absolute_return_pct'],
                "returns": metrics['absolute_return'],
                "invested": metrics['total_invested'],
                "current_value": metrics['current_value'],
                "type": fund.type
            })

    performances.sort(key=lambda x: x['returns_pct'], reverse=True)

    top_5 = performances[:5] if len(performances) >= 5 else performances
    bottom_5 = performances[-5:] if len(performances) >= 5 else []

    return {
        "top_performers": top_5,
        "worst_performers": bottom_5
    }
