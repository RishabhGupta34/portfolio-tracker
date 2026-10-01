import math
from typing import Optional, List, Dict
from datetime import datetime, date, timedelta
from scipy.optimize import newton
from models import Transaction, Fund, Portfolio


def calculate_xirr(transactions: List[Transaction], current_value: float, end_date: str = None) -> Optional[float]:
    """
    Calculate XIRR for a set of transactions.

    Bonus units are received for free (no cash outflow). Their units must count toward
    current_value (which the caller already does), but they must NOT contribute a cash
    flow to XIRR — otherwise XIRR is silently wrong on funds with bonus issues / dividend
    reinvestment that book as bonus rows.
    """
    if not transactions:
        return None

    cash_flows = []
    dates = []

    for txn in transactions:
        if txn.transaction_type == "bonus":
            # Free units — units count in current_value, but no cash flow here.
            continue
        if txn.amount <= 0:
            continue
        if txn.transaction_type == "buy":
            cash_flows.append(-txn.amount)
            dates.append(datetime.fromisoformat(txn.date).date())
        elif txn.transaction_type == "sell":
            cash_flows.append(txn.amount)
            dates.append(datetime.fromisoformat(txn.date).date())

    if not cash_flows:
        return None

    if current_value > 0:
        if end_date:
            final_date = datetime.fromisoformat(end_date).date()
        else:
            final_date = date.today()
        cash_flows.append(current_value)
        dates.append(final_date)
    else:
        return None

    first_date = min(dates)
    days = [(d - first_date).days for d in dates]

    if max(days) < 7:
        return None

    if all(cf <= 0 for cf in cash_flows) or all(cf >= 0 for cf in cash_flows):
        return None

    def xirr_formula(rate):
        try:
            return sum([cf / (1 + rate) ** (day / 365.0) for cf, day in zip(cash_flows, days)])
        except:
            return float('inf')

    try:
        for initial_guess in [0.1, 0.0, -0.1, 0.5, -0.5]:
            try:
                rate = newton(xirr_formula, initial_guess, maxiter=100, tol=1e-6)
                if -0.99 <= rate <= 10.0:
                    return round(rate * 100, 2)
            except:
                continue
        return None
    except Exception as e:
        print(f"XIRR calculation error: {e}")
        return None


def _safe_round(value, decimals=2):
    """Round a value safely, returning 0 for None/NaN/Inf"""
    if value is None or math.isnan(value) or math.isinf(value):
        return 0
    return round(value, decimals)


def calculate_fund_metrics(fund: Fund, historical_data: Dict = None) -> Dict:
    """Calculate various metrics for a fund"""
    if not fund.transactions:
        return {
            "total_invested": 0,
            "current_units": 0,
            "current_value": 0,
            "absolute_return": 0,
            "absolute_return_pct": 0,
            "xirr": None,
            "avg_nav": 0,
        }

    total_invested = 0
    current_units = 0

    for txn in fund.transactions:
        if txn.transaction_type in ["buy", "bonus"]:
            total_invested += txn.amount
            current_units += txn.units
        elif txn.transaction_type == "sell":
            if current_units > 0:
                total_invested -= (txn.units / current_units) * total_invested
            current_units -= txn.units

    if fund.current_nav is not None:
        latest_nav = fund.current_nav
    else:
        latest_nav = fund.transactions[-1].nav if fund.transactions else 0

    current_value = current_units * latest_nav

    absolute_return = current_value - total_invested
    absolute_return_pct = (absolute_return / total_invested * 100) if total_invested > 0 else 0
    avg_nav = total_invested / current_units if current_units > 0 else 0

    xirr = calculate_xirr(fund.transactions, current_value)

    day_change = None
    day_change_pct = None

    if fund.current_nav and current_units > 0:
        yesterday_nav = None

        if fund.previous_nav:
            yesterday_nav = fund.previous_nav
        elif historical_data and (fund.scheme_code or fund.symbol):
            try:
                yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

                if fund.id in historical_data and yesterday in historical_data[fund.id]:
                    yesterday_nav = historical_data[fund.id][yesterday]
                elif fund.id in historical_data:
                    available_dates = sorted([d for d in historical_data[fund.id].keys() if d < datetime.now().strftime('%Y-%m-%d')])
                    if available_dates:
                        yesterday_nav = historical_data[fund.id][available_dates[-1]]
            except:
                pass

        if yesterday_nav:
            previous_value = current_units * yesterday_nav
            day_change = current_value - previous_value
            day_change_pct = (day_change / previous_value * 100) if previous_value > 0 else 0

    return {
        "total_invested": _safe_round(total_invested, 2),
        "current_units": _safe_round(current_units, 4),
        "current_value": _safe_round(current_value, 2),
        "absolute_return": _safe_round(absolute_return, 2),
        "absolute_return_pct": _safe_round(absolute_return_pct, 2),
        "xirr": xirr if xirr is not None and not math.isnan(xirr) and not math.isinf(xirr) else None,
        "avg_nav": _safe_round(avg_nav, 2),
        "latest_nav": _safe_round(latest_nav, 2),
        "day_change": _safe_round(day_change, 2) if day_change is not None else None,
        "day_change_pct": _safe_round(day_change_pct, 2) if day_change_pct is not None else None,
    }


def calculate_account_metrics(account_id: str, funds: List[Fund], historical_data: Dict = None) -> Dict:
    """Calculate aggregated metrics for an account (excludes deposits: FD/PPF/EPF)"""
    account_funds = [f for f in funds if f.account_id == account_id and f.type not in ['fd', 'ppf', 'epf']]

    if not account_funds:
        return {
            "total_invested": 0,
            "current_value": 0,
            "absolute_return": 0,
            "absolute_return_pct": 0,
            "xirr": None,
            "fund_count": 0,
        }

    total_invested = 0
    current_value = 0
    all_transactions = []

    for fund in account_funds:
        metrics = calculate_fund_metrics(fund, historical_data)
        if metrics["current_units"] > 0:
            total_invested += metrics["total_invested"]
            current_value += metrics["current_value"]
            all_transactions.extend(fund.transactions)

    absolute_return = current_value - total_invested
    absolute_return_pct = (absolute_return / total_invested * 100) if total_invested > 0 else 0

    all_transactions.sort(key=lambda x: x.date)
    xirr = calculate_xirr(all_transactions, current_value)

    return {
        "total_invested": _safe_round(total_invested, 2),
        "current_value": _safe_round(current_value, 2),
        "absolute_return": _safe_round(absolute_return, 2),
        "absolute_return_pct": _safe_round(absolute_return_pct, 2),
        "xirr": xirr,
        "fund_count": len(account_funds),
    }


def calculate_portfolio_metrics(portfolio: Portfolio, historical_data: Dict = None) -> Dict:
    """Calculate overall portfolio metrics (excludes deposits: FD/PPF/EPF)"""
    investment_funds = [f for f in portfolio.funds if f.type not in ['fd', 'ppf', 'epf']]

    if not investment_funds:
        return {
            "total_invested": 0,
            "current_value": 0,
            "absolute_return": 0,
            "absolute_return_pct": 0,
            "xirr": None,
            "account_count": len(portfolio.accounts),
            "fund_count": 0,
        }

    total_invested = 0
    current_value = 0
    all_transactions = []
    total_day_change = 0

    for fund in investment_funds:
        metrics = calculate_fund_metrics(fund, historical_data)
        if metrics["current_units"] > 0:
            total_invested += metrics["total_invested"]
            current_value += metrics["current_value"]
            all_transactions.extend(fund.transactions)
            if metrics["day_change"] is not None:
                total_day_change += metrics["day_change"]

    absolute_return = current_value - total_invested
    absolute_return_pct = (absolute_return / total_invested * 100) if total_invested > 0 else 0

    previous_portfolio_value = current_value - total_day_change
    day_change_pct = (total_day_change / previous_portfolio_value * 100) if previous_portfolio_value > 0 else 0

    all_transactions.sort(key=lambda x: x.date)
    xirr = calculate_xirr(all_transactions, current_value)

    return {
        "total_invested": _safe_round(total_invested, 2),
        "current_value": _safe_round(current_value, 2),
        "absolute_return": _safe_round(absolute_return, 2),
        "absolute_return_pct": _safe_round(absolute_return_pct, 2),
        "day_change": _safe_round(total_day_change, 2),
        "day_change_pct": _safe_round(day_change_pct, 2),
        "xirr": xirr,
        "account_count": len(portfolio.accounts),
        "fund_count": len(investment_funds),
    }
