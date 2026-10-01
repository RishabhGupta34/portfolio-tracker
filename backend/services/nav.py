from typing import Optional, List, Dict
from datetime import date
import httpx
import yfinance as yf
from services.cache import load_cached_historical_data, save_cached_historical_data


async def fetch_mutual_fund_nav(scheme_code: str) -> Optional[Dict]:
    """Fetch current NAV for mutual fund using MFAPI"""
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


async def fetch_mutual_fund_historical_nav(scheme_code: str, fund_id: str = None) -> Dict[str, float]:
    """
    Fetch ALL historical NAV data for a mutual fund.
    Returns a dict mapping date (YYYY-MM-DD) to NAV value.
    Uses cache if available.
    """
    if fund_id:
        cached = load_cached_historical_data(fund_id, 'mf')
        if cached and 'nav_history' in cached:
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
                    nav_history = {}
                    for entry in data['data']:
                        date_parts = entry['date'].split('-')
                        if len(date_parts) == 3:
                            iso_date = f"{date_parts[2]}-{date_parts[1]}-{date_parts[0]}"
                            nav_history[iso_date] = float(entry['nav'])

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
    """Search for mutual fund scheme codes by name"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get("https://api.mfapi.in/mf")
            if response.status_code == 200:
                schemes = response.json()
                fund_name_lower = fund_name.lower()
                matches = [
                    {
                        'scheme_code': scheme['schemeCode'],
                        'scheme_name': scheme['schemeName']
                    }
                    for scheme in schemes
                    if fund_name_lower in scheme['schemeName'].lower()
                ]
                return matches[:10]
    except Exception as e:
        print(f"Error searching mutual funds: {e}")
    return []


def fetch_stock_price(symbol: str) -> Optional[Dict]:
    """Fetch current stock price using yfinance (tries NSE then BSE)"""
    try:
        stock_symbol = f"{symbol}.NS"
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

        # Try BSE
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
    """Fetch historical stock prices using yfinance. Uses cache if available."""
    if fund_id:
        cached = load_cached_historical_data(fund_id, 'stock')
        if cached and 'price_history' in cached:
            cache_date = cached.get('updated_date')
            if cache_date == date.today().isoformat():
                print(f"Using cached stock data for {fund_id}")
                return cached['price_history']

    try:
        stock_symbol = f"{symbol}.NS"
        stock = yf.Ticker(stock_symbol)
        hist = stock.history(start=start_date)

        if hist.empty:
            stock_symbol = f"{symbol}.BO"
            stock = yf.Ticker(stock_symbol)
            hist = stock.history(start=start_date)

        if not hist.empty:
            price_history = {}
            for date_idx, row in hist.iterrows():
                date_str = date_idx.strftime('%Y-%m-%d')
                price_history[date_str] = float(row['Close'])

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
    """Fetch mutual fund portfolio holdings (placeholder — free API doesn't support this)"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            return {
                'message': 'Holdings data not available in free API',
                'note': 'This feature requires paid API or web scraping'
            }
    except Exception as e:
        print(f"Error fetching holdings: {e}")
    return None
