from fastapi import APIRouter
from services.portfolio import load_portfolio
from services.cache import load_all_historical_data
from services.metrics import calculate_portfolio_metrics, calculate_account_metrics, calculate_fund_metrics

router = APIRouter()


@router.get("/api/metrics/portfolio")
def get_portfolio_metrics():
    """Get overall portfolio metrics"""
    portfolio = load_portfolio()
    metrics = calculate_portfolio_metrics(portfolio)
    return metrics


@router.get("/api/dashboard")
def get_dashboard_data():
    """Get comprehensive dashboard data"""
    portfolio = load_portfolio()

    historical_data = load_all_historical_data(portfolio)

    portfolio_metrics = calculate_portfolio_metrics(portfolio, historical_data)

    account_metrics = []
    for account in portfolio.accounts:
        metrics = calculate_account_metrics(account.id, portfolio.funds, historical_data)
        account_metrics.append({
            "account": account,
            "metrics": metrics
        })

    fund_metrics = []
    for fund in portfolio.funds:
        if fund.type not in ['fd', 'ppf', 'epf']:
            metrics = calculate_fund_metrics(fund, historical_data)
            fund_metrics.append({
                "fund": fund,
                "metrics": metrics
            })

    return {
        "portfolio_metrics": portfolio_metrics,
        "account_metrics": account_metrics,
        "fund_metrics": fund_metrics
    }


@router.get("/api/realized-gains")
def get_realized_gains():
    """Get realized gains/losses from sell transactions (FIFO cost basis)"""
    portfolio = load_portfolio()

    realized_gains = []
    total_realized_gain = 0
    total_sold_amount = 0
    total_cost_basis = 0

    for fund in portfolio.funds:
        buy_queue = []
        fund_realized_gains = []

        for txn in sorted(fund.transactions, key=lambda x: x.date):
            if txn.transaction_type in ['buy', 'bonus']:
                buy_queue.append({
                    'units': txn.units,
                    'nav': txn.nav,
                    'date': txn.date,
                    'amount': txn.amount
                })
            elif txn.transaction_type == 'sell':
                remaining_units = txn.units
                cost_basis = 0

                while remaining_units > 0 and buy_queue:
                    oldest_buy = buy_queue[0]

                    if oldest_buy['units'] <= remaining_units:
                        cost_basis += oldest_buy['amount']
                        remaining_units -= oldest_buy['units']
                        buy_queue.pop(0)
                    else:
                        proportion = remaining_units / oldest_buy['units']
                        cost_basis += oldest_buy['amount'] * proportion
                        oldest_buy['units'] -= remaining_units
                        oldest_buy['amount'] -= oldest_buy['amount'] * proportion
                        remaining_units = 0

                sell_amount = txn.amount
                realized_gain = sell_amount - cost_basis
                gain_pct = (realized_gain / cost_basis * 100) if cost_basis > 0 else 0

                fund_realized_gains.append({
                    'date': txn.date,
                    'units': txn.units,
                    'sell_nav': txn.nav,
                    'sell_amount': sell_amount,
                    'cost_basis': cost_basis,
                    'realized_gain': realized_gain,
                    'gain_pct': gain_pct
                })

                total_realized_gain += realized_gain
                total_sold_amount += sell_amount
                total_cost_basis += cost_basis

        if fund_realized_gains:
            fund_total_gain = sum(g['realized_gain'] for g in fund_realized_gains)
            fund_total_sold = sum(g['sell_amount'] for g in fund_realized_gains)
            fund_total_cost = sum(g['cost_basis'] for g in fund_realized_gains)

            realized_gains.append({
                'fund_id': fund.id,
                'fund_name': fund.name,
                'fund_type': fund.type,
                'account_id': fund.account_id,
                'transactions': fund_realized_gains,
                'total_realized_gain': round(fund_total_gain, 2),
                'total_sold_amount': round(fund_total_sold, 2),
                'total_cost_basis': round(fund_total_cost, 2),
                'gain_pct': round((fund_total_gain / fund_total_cost * 100) if fund_total_cost > 0 else 0, 2)
            })

    realized_gains.sort(key=lambda x: x['total_realized_gain'], reverse=True)

    return {
        'summary': {
            'total_realized_gain': round(total_realized_gain, 2),
            'total_sold_amount': round(total_sold_amount, 2),
            'total_cost_basis': round(total_cost_basis, 2),
            'overall_gain_pct': round((total_realized_gain / total_cost_basis * 100) if total_cost_basis > 0 else 0, 2),
            'funds_with_sales': len(realized_gains)
        },
        'funds': realized_gains
    }
