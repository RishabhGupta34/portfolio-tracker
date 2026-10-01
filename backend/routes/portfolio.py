from fastapi import APIRouter
from services.portfolio import load_portfolio

router = APIRouter()


@router.get("/")
def read_root():
    return {"message": "Portfolio Tracker API", "version": "1.0.0"}


@router.get("/api/portfolio")
def get_portfolio():
    """Get complete portfolio data"""
    portfolio = load_portfolio()
    return portfolio
