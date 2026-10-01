from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.portfolio import router as portfolio_router
from routes.accounts import router as accounts_router
from routes.funds import router as funds_router
from routes.transactions import router as transactions_router
from routes.nav import router as nav_router
from routes.dashboard import router as dashboard_router
from routes.charts import router as charts_router
from routes.deposits import router as deposits_router

app = FastAPI(title="Portfolio Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(portfolio_router)
app.include_router(accounts_router)
app.include_router(funds_router)
app.include_router(transactions_router)
app.include_router(nav_router)
app.include_router(dashboard_router)
app.include_router(charts_router)
app.include_router(deposits_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
