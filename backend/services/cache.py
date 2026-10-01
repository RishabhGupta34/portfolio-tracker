import json
from pathlib import Path
from typing import Optional, Dict
from config import CACHE_DIR
from models import Portfolio


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
    Load all historical data for all funds in portfolio.
    Returns a dict mapping fund_id to {date: nav}.
    """
    historical_data = {}
    for fund in portfolio.funds:
        if fund.scheme_code or fund.symbol:
            fund_type = "mf" if fund.scheme_code else "stock"
            cached_data = load_cached_historical_data(fund.id, fund_type)
            if cached_data:
                historical_data[fund.id] = cached_data
    return historical_data
