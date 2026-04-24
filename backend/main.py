from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import json
from typing import Optional, List, Dict, Any
from datetime import datetime, date, timedelta
from pydantic import BaseModel
import httpx
import yfinance as yf
from scipy.optimize import newton
import uuid
import math

app = FastAPI(title="Portfolio Tracker API")

# CORS middleware to allow frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data file path
BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data" / "portfolio.json"
CACHE_DIR = BASE_DIR / "data" / "cache"

# Ensure cache directory exists
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Ensure data directory exists
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# Indian Banks List
INDIAN_BANKS = [
    "State Bank of India (SBI)",
    "HDFC Bank",
    "ICICI Bank",
    "Axis Bank",
    "Kotak Mahindra Bank",
    "Punjab National Bank (PNB)",
    "Bank of Baroda",
    "Canara Bank",
    "Union Bank of India",
    "Bank of India",
    "Indian Bank",
    "Central Bank of India",
    "IDBI Bank",
    "Yes Bank",
    "IndusInd Bank",
    "Post Office",
    "Other"
]


# Pydantic models
class Transaction(BaseModel):
    id: str
    date: str  # ISO format date
    units: float
    nav: float
    amount: float
    transaction_type: str  # "buy", "sell", "bonus", "split"
    split_ratio: Optional[str] = None  # For splits: "1:2" means 1 becomes 2
    notes: Optional[str] = None  # Optional notes for the transaction


class Fund(BaseModel):
    id: str
    name: str
    type: str  # "mutual_fund", "stock", "fd", "ppf", "gold", "other"
    account_id: str  # Required - each fund belongs to an account
    transactions: List[Transaction]
    scheme_code: Optional[str] = None  # For mutual funds (MFAPI scheme code)
    symbol: Optional[str] = None  # For stocks (NSE/BSE symbol)
    current_nav: Optional[float] = None  # Latest NAV/price (updated separately)
    previous_nav: Optional[float] = None  # Previous day's NAV for day change calculation
    nav_updated_at: Optional[str] = None  # Date when NAV was last updated
    interest_rate: Optional[float] = None  # For FD/PPF (annual interest rate %)
    maturity_date: Optional[str] = None  # For FD/PPF
    
    # FD-specific fields
    bank: Optional[str] = None  # Bank name
    principal: Optional[float] = None  # FD principal amount
    start_date: Optional[str] = None  # FD start date
    maturity_value: Optional[float] = None  # Calculated maturity value
    
    # PPF-specific fields
    ppf_account_number: Optional[str] = None  # PPF account number


class Account(BaseModel):
    id: str
    name: str
    description: Optional[str] = None  # Optional description for the account


class Portfolio(BaseModel):
    accounts: List[Account]
    funds: List[Fund]


class AddTransactionRequest(BaseModel):
    fund_id: str
    date: str
    units: float
    nav: float
    transaction_type: str
    split_ratio: Optional[str] = None  # For splits: "1:2"
    notes: Optional[str] = None  # Optional notes


class CreateFundRequest(BaseModel):
    name: str
    type: str
    account_id: str  # Required - each investment must belong to an account
    scheme_code: Optional[str] = None  # For mutual funds
    symbol: Optional[str] = None  # For stocks
    interest_rate: Optional[float] = None  # For FD/PPF
    maturity_date: Optional[str] = None  # For FD/PPF
    
    # FD-specific fields
    bank: Optional[str] = None
    principal: Optional[float] = None
    start_date: Optional[str] = None
    
    # PPF-specific fields
    ppf_account_number: Optional[str] = None


class CreateAccountRequest(BaseModel):
    name: str
    description: Optional[str] = None


class FetchNAVRequest(BaseModel):
    fund_name: str
    fund_type: str  # "mutual_fund" or "stock"
    scheme_code: Optional[str] = None  # For mutual funds


class UpdateCurrentNAVRequest(BaseModel):
    fund_id: str


# Helper functions
async def fetch_mutual_fund_nav(scheme_code: str) -> Optional[Dict]:
    """
    Fetch current NAV for mutual fund using MFAPI
    MFAPI provides free access to Indian mutual fund data
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"https://api.mfapi.in/mf/{scheme_code}")
            if response.status_code == 200:
                data = response.json()
                if data and 'data' in data and len(data['data']) > 0:
                    latest = data['data'][0]
                    return {
                        'nav': float(latest['nav']),
                        'date': latest['date'],
                        'scheme_name': data.get('meta', {}).get('scheme_name', '')
                    }
    except Exception as e:
        print(f"Error fetching mutual fund NAV: {e}")
    return None


def get_cache_path(fund_id: str, fund_type: str) -> Path:
    """Get cache file path for a fund"""
    return CACHE_DIR / f"{fund_type}_{fund_id}.json"


def load_cached_historical_data(fund_id: str, fund_type: str) -> Optional[Dict]:
    """Load cached historical data from file"""
    cache_file = get_cache_path(fund_id, fund_type)
    if cache_file.exists():
        try:
            with open(cache_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading cache: {e}")
    return None


def save_cached_historical_data(fund_id: str, fund_type: str, data: Dict):
    """Save historical data to cache file"""
    cache_file = get_cache_path(fund_id, fund_type)
    try:
        with open(cache_file, 'w') as f:
            json.dump(data, f)
    except Exception as e:
        print(f"Error saving cache: {e}")


def load_all_historical_data(portfolio: Portfolio) -> Dict[str, Dict[str, float]]:
    """
    Load all historical data for all funds in portfolio
    Returns a dict mapping fund_id to {date: nav}
    """
    historical_data = {}
    for fund in portfolio.funds:
        if fund.scheme_code or fund.symbol:
            fund_type = "mf" if fund.scheme_code else "stock"
            cached_data = load_cached_historical_data(fund.id, fund_type)
            if cached_data:
                historical_data[fund.id] = cached_data
    return historical_data


async def fetch_mutual_fund_historical_nav(scheme_code: str, fund_id: str = None) -> Dict[str, float]:
    """
    Fetch ALL historical NAV data for a mutual fund
    Returns a dict mapping date (YYYY-MM-DD) to NAV value
    Uses cache if available
    """
    # Try cache first
    if fund_id:
        cached = load_cached_historical_data(fund_id, 'mf')
        if cached and 'nav_history' in cached:
            # Check if cache is recent (updated today)
            cache_date = cached.get('updated_date')
            if cache_date == date.today().isoformat():
                print(f"Using cached MF data for {fund_id}")
                return cached['nav_history']
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"https://api.mfapi.in/mf/{scheme_code}")
            if response.status_code == 200:
                data = response.json()
                if data and 'data' in data:
                    # Convert to dict: date -> NAV
                    nav_history = {}
                    for entry in data['data']:
                        # Parse date from DD-MM-YYYY to YYYY-MM-DD
                        date_parts = entry['date'].split('-')
                        if len(date_parts) == 3:
                            iso_date = f"{date_parts[2]}-{date_parts[1]}-{date_parts[0]}"
                            nav_history[iso_date] = float(entry['nav'])
                    
                    # Save to cache
                    if fund_id:
                        save_cached_historical_data(fund_id, 'mf', {
                            'nav_history': nav_history,
                            'updated_date': date.today().isoformat()
                        })
                    
                    return nav_history
    except Exception as e:
        print(f"Error fetching historical NAV: {e}")
    return {}


async def search_mutual_fund(fund_name: str) -> List[Dict]:
    """
    Search for mutual fund scheme codes by name
    Returns list of matching schemes
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Get all schemes
            response = await client.get("https://api.mfapi.in/mf")
            if response.status_code == 200:
                schemes = response.json()
                # Filter by name (case insensitive)
                fund_name_lower = fund_name.lower()
                matches = [
                    {
                        'scheme_code': scheme['schemeCode'],
                        'scheme_name': scheme['schemeName']
                    }
                    for scheme in schemes
                    if fund_name_lower in scheme['schemeName'].lower()
                ]
                return matches[:10]  # Return top 10 matches
    except Exception as e:
        print(f"Error searching mutual funds: {e}")
    return []


def fetch_stock_price(symbol: str) -> Optional[Dict]:
    """
    Fetch current stock price using yfinance
    For Indian stocks/ETFs, append .NS (NSE) or .BO (BSE)
    """
    try:
        # Try NSE first
        stock_symbol = f"{symbol}.NS"
        stock = yf.Ticker(stock_symbol)
        
        # Try getting price from history if info doesn't have currentPrice
        hist = stock.history(period='1d')
        if not hist.empty:
            price = float(hist['Close'].iloc[-1])
            info = stock.info
            return {
                'price': price,
                'symbol': stock_symbol,
                'name': info.get('longName', info.get('shortName', symbol))
            }
        
        # Check info as fallback
        info = stock.info
        if 'currentPrice' in info and info['currentPrice']:
            return {
                'price': float(info['currentPrice']),
                'symbol': stock_symbol,
                'name': info.get('longName', info.get('shortName', symbol))
            }
        
        # Try BSE if NSE fails
        stock_symbol = f"{symbol}.BO"
        stock = yf.Ticker(stock_symbol)
        
        hist = stock.history(period='1d')
        if not hist.empty:
            price = float(hist['Close'].iloc[-1])
            info = stock.info
            return {
                'price': price,
                'symbol': stock_symbol,
                'name': info.get('longName', info.get('shortName', symbol))
            }
        
        info = stock.info
        if 'currentPrice' in info and info['currentPrice']:
            return {
                'price': float(info['currentPrice']),
                'symbol': stock_symbol,
                'name': info.get('longName', info.get('shortName', symbol))
            }
    except Exception as e:
        print(f"Error fetching stock price for {symbol}: {e}")
    return None


def fetch_stock_historical_prices(symbol: str, start_date: str, fund_id: str = None) -> Dict[str, float]:
    """
    Fetch historical stock prices using yfinance
    Returns a dict mapping date (YYYY-MM-DD) to closing price
    Uses cache if available
    """
    # Try cache first
    if fund_id:
        cached = load_cached_historical_data(fund_id, 'stock')
        if cached and 'price_history' in cached:
            # Check if cache is recent (updated today)
            cache_date = cached.get('updated_date')
            if cache_date == date.today().isoformat():
                print(f"Using cached stock data for {fund_id}")
                return cached['price_history']
    
    try:
        # Try NSE first
        stock_symbol = f"{symbol}.NS"
        stock = yf.Ticker(stock_symbol)
        
        # Get historical data from start_date to today
        hist = stock.history(start=start_date)
        
        if hist.empty:
            # Try BSE if NSE fails
            stock_symbol = f"{symbol}.BO"
            stock = yf.Ticker(stock_symbol)
            hist = stock.history(start=start_date)
        
        if not hist.empty:
            # Convert to dict: date -> close price
            price_history = {}
            for date_idx, row in hist.iterrows():
                date_str = date_idx.strftime('%Y-%m-%d')
                price_history[date_str] = float(row['Close'])
            
            # Save to cache
            if fund_id:
                save_cached_historical_data(fund_id, 'stock', {
                    'price_history': price_history,
                    'updated_date': date.today().isoformat()
                })
            
            return price_history
    except Exception as e:
        print(f"Error fetching historical prices: {e}")
    return {}


async def fetch_mutual_fund_holdings(scheme_code: str) -> Optional[Dict]:
    """
    Fetch mutual fund portfolio holdings/composition
    This shows what stocks/assets the mutual fund invests in
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # MFAPI doesn't provide holdings, but we can note this for future enhancement
            # Alternative: Use AMFI website scraping or paid APIs
            # For now, return a placeholder
            return {
                'message': 'Holdings data not available in free API',
                'note': 'This feature requires paid API or web scraping'
            }
    except Exception as e:
        print(f"Error fetching holdings: {e}")
    return None
def load_portfolio() -> Portfolio:
    """Load portfolio data from JSON file"""
    if not DATA_FILE.exists():
        return Portfolio(accounts=[], funds=[])
    
    try:
        with open(DATA_FILE, 'r') as f:
            data = json.load(f)
            return Portfolio(**data)
    except Exception as e:
        print(f"Error loading portfolio: {e}")
        return Portfolio(accounts=[], funds=[])


def save_portfolio(portfolio: Portfolio):
    """Save portfolio data to JSON file"""
    try:
        with open(DATA_FILE, 'w') as f:
            json.dump(portfolio.dict(), f, indent=2)
    except Exception as e:
        print(f"Error saving portfolio: {e}")
        raise HTTPException(status_code=500, detail="Failed to save portfolio")


def calculate_xirr(transactions: List[Transaction], current_value: float, end_date: str = None) -> Optional[float]:
    """
    Calculate XIRR (Extended Internal Rate of Return) for a set of transactions
    """
    if not transactions:
        return None
    
    # Filter and sort transactions by date
    valid_transactions = [t for t in transactions if t.amount > 0]
    if not valid_transactions:
        return None
        
    # Create cash flows and dates
    cash_flows = []
    dates = []
    
    for txn in valid_transactions:
        if txn.transaction_type in ["buy", "bonus"]:
            cash_flows.append(-txn.amount)  # Negative for investments
            dates.append(datetime.fromisoformat(txn.date).date())
        elif txn.transaction_type == "sell":
            cash_flows.append(txn.amount)  # Positive for redemptions
            dates.append(datetime.fromisoformat(txn.date).date())
    
    # Skip if no cash flows
    if not cash_flows:
        return None
        
    # Add current value as final positive cash flow (only if positive)
    if current_value > 0:
        # Use provided end_date or today's date
        if end_date:
            final_date = datetime.fromisoformat(end_date).date()
        else:
            final_date = date.today()
        cash_flows.append(current_value)
        dates.append(final_date)
    else:
        # If current value is 0 or negative, can't calculate meaningful XIRR
        return None
    
    # Calculate days from first transaction
    first_date = min(dates)
    days = [(d - first_date).days for d in dates]
    
    # If holding period is less than 7 days, XIRR is not meaningful
    if max(days) < 7:
        return None
    
    # Check if all cash flows are the same sign (no return possible)
    if all(cf <= 0 for cf in cash_flows) or all(cf >= 0 for cf in cash_flows):
        return None
    
    # XIRR calculation using Newton's method
    def xirr_formula(rate):
        try:
            return sum([cf / (1 + rate) ** (day / 365.0) for cf, day in zip(cash_flows, days)])
        except:
            return float('inf')  # Return large value if calculation fails
    
    try:
        # Try multiple initial guesses to find a solution
        for initial_guess in [0.1, 0.0, -0.1, 0.5, -0.5]:
            try:
                rate = newton(xirr_formula, initial_guess, maxiter=100, tol=1e-6)
                
                # Sanity check: XIRR should be reasonable (-99% to 1000%)
                if -0.99 <= rate <= 10.0:
                    return round(rate * 100, 2)  # Return as percentage
            except:
                continue  # Try next initial guess
                
        # If no valid solution found, return None
        return None
    except Exception as e:
        print(f"XIRR calculation error: {e}")
        return None


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
            # Proportional reduction in invested amount
            if current_units > 0:
                total_invested -= (txn.units / current_units) * total_invested
            current_units -= txn.units
        # Skip split transactions in metrics calculation (they're already adjusted)
    
    # Get latest NAV: use current_nav if set, otherwise use most recent transaction
    if fund.current_nav is not None:
        latest_nav = fund.current_nav
    else:
        latest_nav = fund.transactions[-1].nav if fund.transactions else 0
    
    current_value = current_units * latest_nav
    
    absolute_return = current_value - total_invested
    absolute_return_pct = (absolute_return / total_invested * 100) if total_invested > 0 else 0
    avg_nav = total_invested / current_units if current_units > 0 else 0
    
    xirr = calculate_xirr(fund.transactions, current_value)
    
    # Calculate day change - use historical data to get yesterday's NAV
    day_change = None
    day_change_pct = None
    
    if fund.current_nav and current_units > 0:
        # Try to get yesterday's NAV from historical data
        yesterday_nav = None
        
        # First try previous_nav if it exists
        if fund.previous_nav:
            yesterday_nav = fund.previous_nav
        # Otherwise, try to fetch from historical data (if provided)
        elif historical_data and (fund.scheme_code or fund.symbol):
            try:
                from datetime import datetime, timedelta
                yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
                
                if fund.id in historical_data and yesterday in historical_data[fund.id]:
                    yesterday_nav = historical_data[fund.id][yesterday]
                elif fund.id in historical_data:
                    # Find the most recent NAV before today
                    available_dates = sorted([d for d in historical_data[fund.id].keys() if d < datetime.now().strftime('%Y-%m-%d')])
                    if available_dates:
                        yesterday_nav = historical_data[fund.id][available_dates[-1]]
            except:
                pass
        
        if yesterday_nav:
            previous_value = current_units * yesterday_nav
            day_change = current_value - previous_value
            day_change_pct = (day_change / previous_value * 100) if previous_value > 0 else 0
    
    # Safety check for NaN and infinity
    import math
    def safe_round(value, decimals=2):
        if value is None or math.isnan(value) or math.isinf(value):
            return 0
        return round(value, decimals)
    
    return {
        "total_invested": safe_round(total_invested, 2),
        "current_units": safe_round(current_units, 4),
        "current_value": safe_round(current_value, 2),
        "absolute_return": safe_round(absolute_return, 2),
        "absolute_return_pct": safe_round(absolute_return_pct, 2),
        "xirr": xirr if xirr is not None and not math.isnan(xirr) and not math.isinf(xirr) else None,
        "avg_nav": safe_round(avg_nav, 2),
        "latest_nav": safe_round(latest_nav, 2),
        "day_change": safe_round(day_change, 2) if day_change is not None else None,
        "day_change_pct": safe_round(day_change_pct, 2) if day_change_pct is not None else None,
    }


def calculate_account_metrics(account_id: str, funds: List[Fund], historical_data: Dict = None) -> Dict:
    """Calculate aggregated metrics for an account (excludes deposits: FD/PPF/EPF)"""
    # Filter out deposits (FD, PPF, EPF) from account metrics
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
        # Only include funds with current units > 0
        if metrics["current_units"] > 0:
            total_invested += metrics["total_invested"]
            current_value += metrics["current_value"]
            all_transactions.extend(fund.transactions)
    
    absolute_return = current_value - total_invested
    absolute_return_pct = (absolute_return / total_invested * 100) if total_invested > 0 else 0
    
    # Sort transactions by date for XIRR calculation
    all_transactions.sort(key=lambda x: x.date)
    xirr = calculate_xirr(all_transactions, current_value)
    
    return {
        "total_invested": round(total_invested, 2),
        "current_value": round(current_value, 2),
        "absolute_return": round(absolute_return, 2),
        "absolute_return_pct": round(absolute_return_pct, 2),
        "xirr": xirr,
        "fund_count": len(account_funds),
    }


def calculate_portfolio_metrics(portfolio: Portfolio, historical_data: Dict = None) -> Dict:
    """Calculate overall portfolio metrics (excludes deposits: FD/PPF/EPF)"""
    # Filter out deposits from portfolio metrics
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
        # Only include funds with current units > 0
        if metrics["current_units"] > 0:
            total_invested += metrics["total_invested"]
            current_value += metrics["current_value"]
            all_transactions.extend(fund.transactions)
            if metrics["day_change"] is not None:
                total_day_change += metrics["day_change"]
    
    absolute_return = current_value - total_invested
    absolute_return_pct = (absolute_return / total_invested * 100) if total_invested > 0 else 0
    
    # Calculate portfolio-wide day change percentage
    previous_portfolio_value = current_value - total_day_change
    day_change_pct = (total_day_change / previous_portfolio_value * 100) if previous_portfolio_value > 0 else 0
    
    # Sort transactions by date for XIRR calculation
    all_transactions.sort(key=lambda x: x.date)
    xirr = calculate_xirr(all_transactions, current_value)
    
    return {
        "total_invested": round(total_invested, 2),
        "current_value": round(current_value, 2),
        "absolute_return": round(absolute_return, 2),
        "absolute_return_pct": round(absolute_return_pct, 2),
        "day_change": round(total_day_change, 2),
        "day_change_pct": round(day_change_pct, 2),
        "xirr": xirr,
        "account_count": len(portfolio.accounts),
        "fund_count": len(investment_funds),
    }


# API Routes
@app.get("/")
def read_root():
    return {"message": "Portfolio Tracker API", "version": "1.0.0"}


@app.get("/api/portfolio")
def get_portfolio():
    """Get complete portfolio data"""
    portfolio = load_portfolio()
    return portfolio


@app.get("/api/accounts")
def get_accounts():
    """Get all accounts"""
    portfolio = load_portfolio()
    return portfolio.accounts


@app.post("/api/accounts")
def create_account(request: CreateAccountRequest):
    """Create a new account"""
    portfolio = load_portfolio()
    
    # Generate unique ID
    account_id = f"acc_{len(portfolio.accounts) + 1}_{datetime.now().timestamp()}"
    
    new_account = Account(
        id=account_id,
        name=request.name,
        description=request.description
    )
    
    portfolio.accounts.append(new_account)
    save_portfolio(portfolio)
    
    return new_account


@app.get("/api/funds")
def get_funds():
    """Get all funds"""
    portfolio = load_portfolio()
    return portfolio.funds


@app.get("/api/funds/{fund_id}")
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


@app.post("/api/funds")
def create_fund(request: CreateFundRequest):
    """Create a new fund"""
    portfolio = load_portfolio()
    
    # Verify account exists
    account = next((a for a in portfolio.accounts if a.id == request.account_id), None)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    # Generate unique ID
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
        ppf_account_number=request.ppf_account_number
    )
    
    portfolio.funds.append(new_fund)
    save_portfolio(portfolio)
    
    return new_fund


@app.post("/api/transactions")
def add_transaction(request: AddTransactionRequest):
    """Add a transaction to a fund"""
    portfolio = load_portfolio()
    
    # Find the fund
    fund = next((f for f in portfolio.funds if f.id == request.fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")
    
    # Generate unique transaction ID
    txn_id = f"txn_{len(fund.transactions) + 1}_{datetime.now().timestamp()}"
    
    # Calculate amount (0 for bonus/split)
    if request.transaction_type in ['bonus', 'split']:
        amount = 0
    else:
        amount = request.units * request.nav
    
    # For stock split, calculate the NAV based on current holdings
    split_nav = request.nav
    if request.transaction_type == 'split' and request.split_ratio:
        try:
            # Parse split ratio (e.g., "1:2" means 1 becomes 2)
            old_shares, new_shares = map(int, request.split_ratio.split(':'))
            multiplier = new_shares / old_shares
            
            # Calculate total units and invested amount before split
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
            
            # Calculate average NAV before split
            if total_units_before > 0:
                avg_nav_before = total_invested / total_units_before
                # After split, NAV adjusts inversely
                split_nav = avg_nav_before / multiplier
            
            # Adjust all transactions before this split
            for txn in fund.transactions:
                if txn.date < request.date and txn.transaction_type in ['buy', 'sell', 'bonus']:
                    txn.units = txn.units * multiplier
                    txn.nav = txn.nav / multiplier  # NAV adjusts inversely
                    # Amount stays the same (units * nav = same)
        except Exception as e:
            print(f"Error processing split: {e}")
    
    new_transaction = Transaction(
        id=txn_id,
        date=request.date,
        units=request.units,
        nav=split_nav,  # Use calculated NAV for splits
        amount=amount,
        transaction_type=request.transaction_type,
        split_ratio=request.split_ratio,
        notes=request.notes
    )
    
    fund.transactions.append(new_transaction)
    
    # Sort transactions by date
    fund.transactions.sort(key=lambda x: x.date)
    
    save_portfolio(portfolio)
    
    return new_transaction


@app.delete("/api/transactions/{fund_id}/{transaction_id}")
def delete_transaction(fund_id: str, transaction_id: str):
    """Delete a transaction"""
    portfolio = load_portfolio()
    
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")
    
    fund.transactions = [t for t in fund.transactions if t.id != transaction_id]
    save_portfolio(portfolio)
    
    return {"message": "Transaction deleted successfully"}


@app.delete("/api/funds/{fund_id}")
def delete_fund(fund_id: str):
    """Delete a fund/investment"""
    portfolio = load_portfolio()
    
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")
    
    # Remove the fund
    portfolio.funds = [f for f in portfolio.funds if f.id != fund_id]
    save_portfolio(portfolio)
    
    return {"message": "Investment deleted successfully"}


@app.get("/api/metrics/portfolio")
def get_portfolio_metrics():
    """Get overall portfolio metrics"""
    portfolio = load_portfolio()
    metrics = calculate_portfolio_metrics(portfolio)
    return metrics


@app.get("/api/metrics/account/{account_id}")
def get_account_metrics(account_id: str):
    """Get metrics for a specific account"""
    portfolio = load_portfolio()
    
    account = next((a for a in portfolio.accounts if a.id == account_id), None)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    metrics = calculate_account_metrics(account_id, portfolio.funds)
    return metrics


@app.get("/api/metrics/fund/{fund_id}")
def get_fund_metrics_endpoint(fund_id: str):
    """Get metrics for a specific fund"""
    portfolio = load_portfolio()
    
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")
    
    metrics = calculate_fund_metrics(fund)
    return metrics


@app.get("/api/dashboard")
def get_dashboard_data():
    """Get comprehensive dashboard data"""
    portfolio = load_portfolio()
    
    # Load historical data once for all calculations
    historical_data = load_all_historical_data(portfolio)
    
    # Overall metrics
    portfolio_metrics = calculate_portfolio_metrics(portfolio, historical_data)
    
    # Account-wise metrics
    account_metrics = []
    for account in portfolio.accounts:
        metrics = calculate_account_metrics(account.id, portfolio.funds, historical_data)
        account_metrics.append({
            "account": account,
            "metrics": metrics
        })
    
    # Fund-wise metrics (exclude FD/PPF/EPF - they're tracked in Deposits tab)
    fund_metrics = []
    for fund in portfolio.funds:
        if fund.type not in ['fd', 'ppf', 'epf']:  # Exclude deposits
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


@app.get("/api/nav/search/mutual-fund/{fund_name}")
async def search_mutual_fund_endpoint(fund_name: str):
    """Search for mutual fund schemes by name"""
    results = await search_mutual_fund(fund_name)
    return {"results": results}


@app.get("/api/nav/mutual-fund/{scheme_code}")
async def get_mutual_fund_nav(scheme_code: str):
    """Get current NAV for a mutual fund scheme"""
    nav_data = await fetch_mutual_fund_nav(scheme_code)
    if nav_data:
        return nav_data
    raise HTTPException(status_code=404, detail="NAV data not found")


@app.get("/api/nav/stock/{symbol}")
def get_stock_price_endpoint(symbol: str):
    """Get current price for a stock (NSE/BSE)"""
    price_data = fetch_stock_price(symbol)
    if price_data:
        return price_data
    raise HTTPException(status_code=404, detail="Stock price not found")


@app.post("/api/funds/{fund_id}/update-nav")
async def update_fund_current_nav(fund_id: str):
    """
    Automatically fetch and update current NAV without creating a transaction
    """
    portfolio = load_portfolio()
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")
    
    # Fetch current NAV/price
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
    else:  # stock
        symbol = fund.symbol or fund.name
        price_data = fetch_stock_price(symbol)
        if price_data:
            current_nav = price_data['price']
            nav_date = date.today().isoformat()
    
    if current_nav:
        # Store current NAV as previous NAV before updating
        if fund.current_nav:
            fund.previous_nav = fund.current_nav
        
        # Update the fund's current NAV (no transaction created)
        fund.current_nav = current_nav
        fund.nav_updated_at = nav_date or date.today().isoformat()
        save_portfolio(portfolio)
        
        # Calculate day change
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


@app.get("/api/funds/{fund_id}/holdings")
async def get_fund_holdings(fund_id: str, scheme_code: Optional[str] = None):
    """
    Get mutual fund portfolio holdings/composition
    Shows what stocks/assets the fund invests in
    """
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


@app.get("/api/charts/portfolio-timeline")
async def get_portfolio_timeline(account_id: str = None, fund_type: str = None):
    """
    Get portfolio value over time for charting (excludes FD/PPF/EPF)
    Returns data points based on transaction dates and current NAV
    Supports filtering by account_id and fund_type
    """
    portfolio = load_portfolio()
    
    if not portfolio.funds:
        return {"timeline": []}
    
    # Filter funds based on parameters - always exclude deposits
    filtered_funds = [f for f in portfolio.funds if f.type not in ['fd', 'ppf', 'epf']]
    if account_id and account_id != 'all':
        filtered_funds = [f for f in filtered_funds if f.account_id == account_id]
    if fund_type and fund_type != 'all':
        filtered_funds = [f for f in filtered_funds if f.type == fund_type]
    
    if not filtered_funds:
        return {"timeline": []}
    
    # Collect all transaction dates from filtered funds
    all_dates = set()
    for fund in filtered_funds:
        for txn in fund.transactions:
            all_dates.add(txn.date)
    
    if not all_dates:
        return {"timeline": []}
    
    # Add today's date
    today = date.today().isoformat()
    all_dates.add(today)
    
    # Sort dates and get first and last
    sorted_dates = sorted(list(all_dates))
    first_date = datetime.fromisoformat(sorted_dates[0]).date()
    last_date = datetime.fromisoformat(sorted_dates[-1]).date()
    
    # Generate monthly data points for smoother graph
    sample_dates = set(sorted_dates)  # Include all transaction dates
    
    # Add monthly samples between first and last date
    current = first_date
    while current <= last_date:
        sample_dates.add(current.isoformat())
        # Move to first day of next month
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1, day=1)
        else:
            current = current.replace(month=current.month + 1, day=1)
    
    # Sort all sample dates
    sorted_dates = sorted(list(sample_dates))
    
    # Fetch historical NAV data for filtered funds (async) with caching
    print("Fetching historical NAV data...")
    historical_data = {}
    for fund in filtered_funds:
        if fund.type == 'mutual_fund' and fund.scheme_code:
            historical_data[fund.id] = await fetch_mutual_fund_historical_nav(fund.scheme_code, fund.id)
        elif fund.type == 'stock' and fund.symbol:
            historical_data[fund.id] = fetch_stock_historical_prices(fund.symbol, first_date.isoformat(), fund.id)
    
    print(f"Fetched/cached historical data for {len(historical_data)} funds")
    
    # Calculate portfolio value at each date for filtered funds
    timeline = []
    for target_date in sorted_dates:
        total_invested = 0
        total_value = 0
        all_transactions_to_date = []  # For XIRR calculation
        
        for fund in filtered_funds:
            # Get transactions up to this date
            relevant_txns = [t for t in fund.transactions if t.date <= target_date]
            if not relevant_txns:
                continue
            
            # Calculate invested and current value
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
                # Skip split transactions
            
            # Skip funds with 0 units
            if units <= 0:
                continue
            
            # Add transactions for XIRR calculation
            all_transactions_to_date.extend(relevant_txns)
            
            # Try to get historical NAV for this date
            latest_nav = None
            if fund.id in historical_data:
                # Try exact date first
                if target_date in historical_data[fund.id]:
                    latest_nav = historical_data[fund.id][target_date]
                else:
                    # Find nearest previous date with NAV data
                    available_dates = sorted([d for d in historical_data[fund.id].keys() if d <= target_date])
                    if available_dates:
                        latest_nav = historical_data[fund.id][available_dates[-1]]
            
            # If still no NAV, try current NAV for today
            if latest_nav is None and target_date == today and fund.current_nav is not None:
                latest_nav = fund.current_nav
            
            # Last resort: use transaction NAV
            if latest_nav is None:
                latest_nav = relevant_txns[-1].nav
            
            current_value = units * latest_nav
            
            total_invested += invested
            total_value += current_value
        
        # Calculate XIRR for this point in time
        xirr = None
        if all_transactions_to_date and total_value > 0:
            # Sort transactions by date for XIRR calculation
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


@app.get("/api/charts/account-allocation")
def get_account_allocation():
    """
    Get account-wise allocation for pie chart (excludes FD/PPF/EPF)
    """
    portfolio = load_portfolio()
    
    allocations = []
    for account in portfolio.accounts:
        # Filter out deposits
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


@app.get("/api/charts/fund-performance")
def get_fund_performance():
    """
    Get fund-wise performance comparison for bar chart (excludes FD/PPF/EPF)
    """
    portfolio = load_portfolio()
    
    performances = []
    for fund in portfolio.funds:
        # Exclude FD/PPF/EPF from performance charts
        if fund.type in ['fd', 'ppf', 'epf']:
            continue
            
        metrics = calculate_fund_metrics(fund)
        # Only include funds with current units > 0
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
    
    # Sort by returns percentage
    performances.sort(key=lambda x: x['returns_pct'], reverse=True)
    
    return {"performances": performances}


@app.get("/api/charts/asset-type-allocation")
def get_asset_type_allocation():
    """
    Get allocation by asset type (mutual funds, stocks, etc.) - excludes FD/PPF/EPF
    """
    portfolio = load_portfolio()
    
    allocation = {}
    
    for fund in portfolio.funds:
        # Skip FD/PPF/EPF as they're tracked separately in Deposits
        if fund.type in ['fd', 'ppf', 'epf']:
            continue
            
        if fund.type not in allocation:
            allocation[fund.type] = {"value": 0, "invested": 0, "count": 0}
        
        metrics = calculate_fund_metrics(fund)
        if metrics['total_invested'] > 0:
            allocation[fund.type]["value"] += metrics['current_value']
            allocation[fund.type]["invested"] += metrics['total_invested']
            allocation[fund.type]["count"] += 1
    
    # Convert to list format for charts
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


@app.get("/api/charts/top-performers")
def get_top_performers():
    """
    Get top 5 best and worst performing funds (excludes FD/PPF/EPF)
    """
    portfolio = load_portfolio()
    
    performances = []
    for fund in portfolio.funds:
        # Exclude FD/PPF/EPF from top performers
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
    
    # Sort by returns percentage
    performances.sort(key=lambda x: x['returns_pct'], reverse=True)
    
    # Get top 5 and bottom 5
    top_5 = performances[:5] if len(performances) >= 5 else performances
    bottom_5 = performances[-5:] if len(performances) >= 5 else []
    
    return {
        "top_performers": top_5,
        "worst_performers": bottom_5
    }


@app.get("/api/realized-gains")
def get_realized_gains():
    """
    Get realized gains/losses from sell transactions
    Shows profits/losses from investments that have been sold
    """
    portfolio = load_portfolio()
    
    realized_gains = []
    total_realized_gain = 0
    total_sold_amount = 0
    total_cost_basis = 0
    
    for fund in portfolio.funds:
        # Track cost basis using FIFO (First In First Out)
        buy_queue = []  # [(units, nav, date)]
        fund_realized_gains = []
        
        for txn in sorted(fund.transactions, key=lambda x: x.date):
            if txn.transaction_type in ['buy', 'bonus']:
                # Add to buy queue
                buy_queue.append({
                    'units': txn.units,
                    'nav': txn.nav,
                    'date': txn.date,
                    'amount': txn.amount
                })
            elif txn.transaction_type == 'sell':
                # Calculate realized gain using FIFO
                remaining_units = txn.units
                cost_basis = 0
                
                while remaining_units > 0 and buy_queue:
                    oldest_buy = buy_queue[0]
                    
                    if oldest_buy['units'] <= remaining_units:
                        # Use entire oldest buy
                        cost_basis += oldest_buy['amount']
                        remaining_units -= oldest_buy['units']
                        buy_queue.pop(0)
                    else:
                        # Partial use of oldest buy
                        proportion = remaining_units / oldest_buy['units']
                        cost_basis += oldest_buy['amount'] * proportion
                        oldest_buy['units'] -= remaining_units
                        oldest_buy['amount'] -= oldest_buy['amount'] * proportion
                        remaining_units = 0
                
                # Calculate gain/loss
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
        
        # Only include funds with sell transactions
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
    
    # Sort by total realized gain (highest first)
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


@app.get("/api/banks")
def get_banks():
    """
    Get list of Indian banks
    """
    return {"banks": INDIAN_BANKS}


@app.post("/api/funds/{fund_id}/calculate-fd-maturity")
def calculate_fd_maturity(fund_id: str):
    """
    Calculate FD maturity value
    """
    portfolio = load_portfolio()
    
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")
    
    if fund.type != 'fd':
        raise HTTPException(status_code=400, detail="Only for FD type")
    
    if not fund.principal or not fund.interest_rate or not fund.start_date or not fund.maturity_date:
        raise HTTPException(status_code=400, detail="Missing FD details (principal, rate, dates)")
    
    # Calculate tenure
    start = datetime.fromisoformat(fund.start_date)
    maturity = datetime.fromisoformat(fund.maturity_date)
    days = (maturity - start).days
    years = days / 365
    
    principal = fund.principal
    rate = fund.interest_rate / 100
    
    # Most Indian banks use COMPOUND interest with QUARTERLY compounding for cumulative FDs
    # Formula: A = P × (1 + r/n)^(n×t)
    # where n = 4 (quarterly compounding)
    
    # However, some banks/scenarios use simple interest:
    # Formula: A = P × (1 + r×t)
    
    # Using COMPOUND interest (standard for most banks):
    n = 4  # Quarterly compounding
    maturity_value = principal * ((1 + rate/n) ** (n * years))
    interest = maturity_value - principal

    # Update fund
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


@app.post("/api/funds/{fund_id}/calculate-interest")
def calculate_interest(fund_id: str):
    """
    Calculate and add interest for PPF/FD/EPF type investments
    """
    portfolio = load_portfolio()
    
    fund = next((f for f in portfolio.funds if f.id == fund_id), None)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")
    
    if fund.type not in ['ppf', 'fd', 'epf']:
        raise HTTPException(status_code=400, detail="Interest calculation only available for PPF/FD/EPF")
    
    if not fund.interest_rate:
        raise HTTPException(status_code=400, detail="Interest rate not set for this fund")
    
    # Calculate total principal (sum of all buy transactions)
    total_principal = sum(t.amount for t in fund.transactions if t.transaction_type == 'buy')
    
    if total_principal == 0:
        raise HTTPException(status_code=400, detail="No deposits found")
    
    # Calculate interest based on type
    annual_rate = fund.interest_rate / 100
    
    if fund.type == 'ppf':
        # PPF: Compound interest, calculated quarterly
        # Simple approach: annual interest on current balance
        interest = total_principal * annual_rate
    elif fund.type == 'fd':
        # FD: Simple or compound based on term
        # For now, simple annual interest
        interest = total_principal * annual_rate
    else:  # epf
        # EPF: Compound interest annually
        interest = total_principal * annual_rate
    
    # Add interest as a transaction (NAV = 1 for deposits)
    from datetime import date
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
