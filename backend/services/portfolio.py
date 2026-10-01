import json
from fastapi import HTTPException
from config import DATA_FILE
from models import Portfolio


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
