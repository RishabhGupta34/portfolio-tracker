# Portfolio Tracker -- Agent Skills Reference

This file describes the codebase structure and conventions for AI agents working on this project.

## Architecture

Full-stack app with two runtime modes:

1. **Backend mode** -- Python FastAPI server (`backend/main.py`) serves a REST API at `:8000`. Data persists in `backend/data/portfolio.json`. Frontend at `:3000` calls the API via axios.
2. **Standalone/PWA mode** -- No backend needed. `frontend/src/lib/api.js` wraps `localApi.js` which stores everything in IndexedDB. The `api.js` layer maintains the same interface shape (`{ data: ... }`) so components don't know the difference.

## Backend (`backend/main.py`)

Single-file FastAPI app (~1600 lines). Key sections:

- **Lines 1-30**: Imports, CORS setup, data file path
- **Pydantic models**: `Account`, `Fund`, `Transaction`, `Portfolio` -- flat JSON structure
- **CRUD endpoints**: `/api/accounts`, `/api/funds`, `/api/transactions`
- **Metrics**: `/api/dashboard`, `/api/metrics/portfolio`, `/api/metrics/fund/{id}`, `/api/metrics/account/{id}`
- **NAV fetching**: Uses `httpx` to call `api.mfapi.in` for mutual funds, `yfinance` for stocks
- **Charts**: `/api/charts/portfolio-timeline`, `/api/charts/account-allocation`, `/api/charts/fund-performance`
- **XIRR calculation**: Uses `scipy.optimize.newton` (Newton-Raphson method)
- **FD/PPF/EPF**: Maturity calculation, interest computation endpoints
- **Caching**: Historical NAV data cached in `backend/data/cache/` as timestamped JSON files

### Adding a new backend endpoint

1. Define Pydantic request/response models if needed
2. Add the route function with `@app.get/post/put/delete` decorator
3. Use `load_portfolio()` / `save_portfolio()` for data access
4. Follow existing patterns for error handling (`HTTPException`)

## Frontend

React 18 + Vite + TailwindCSS. Tab-based single-page layout.

### Component hierarchy

```
App.jsx
├── Dashboard, Accounts, Investments, Deposits
├── DayChange, RealizedGains, Charts
├── FundInsights, PortfolioXRay
├── ThemeToggle, RefreshPortfolio
├── InstallPrompt, AutoRefreshNAV
└── Toaster
```

### Key libraries (`frontend/src/lib/`)

| File | Purpose |
|------|---------|
| `api.js` | Main API layer -- wraps `localApi.js`, maintains axios-like `{ data }` response shape |
| `localApi.js` | IndexedDB-backed implementation of all API methods |
| `storage.js` | IndexedDB init, get/set helpers |
| `calculations.js` | XIRR, returns, portfolio metrics (client-side) |
| `fundUtils.js` | Fund type detection, NAV fetching helpers |
| `fundAnalysis.js` | Fund scoring, overlap detection, sector analysis |
| `holdingsAnalysis.js` | Portfolio X-ray, holdings breakdown |
| `benchmark.js` | Benchmark comparison (Nifty 50, etc.) |
| `scoringEngine.js` | Multi-factor fund scoring |
| `backgroundAnalysis.js` | Web Worker-style background analysis runner |
| `metricTooltips.js` | Tooltip text for financial metrics |
| `utils.js` | `cn()` (clsx + tailwind-merge), formatters |

### UI primitives (`frontend/src/components/ui/`)

Reusable components: `Button`, `Card`, `Modal`, `Input`, `DateInput`, `Toast`, `Tooltip`, `Skeleton`, `AnimatedCard`. All use TailwindCSS with theme variables (`bg-background`, `text-foreground`, `border`, `bg-primary`, etc.).

### Styling

- TailwindCSS with custom theme in `tailwind.config.js`
- CSS variables for theming (dark/light) defined in `index.css`
- Use `cn()` from `lib/utils.js` for conditional classes

### Adding a new component

1. Create in `components/`
2. Import and add to the tabs array + render section in `App.jsx`
3. Use UI primitives from `components/ui/` for consistency
4. Use `portfolioApi` from `lib/api.js` for data access

## Data Format

Portfolio JSON structure (both backend file and IndexedDB):

```json
{
  "accounts": [
    { "id": "acc_...", "name": "Zerodha", "type": "mutual_fund" }
  ],
  "funds": [
    {
      "id": "fund_...",
      "name": "HDFC Top 100 Fund",
      "type": "mutual_fund",
      "account_id": "acc_...",
      "scheme_code": "112345",
      "current_nav": 150.5,
      "transactions": [
        { "id": "txn_...", "date": "2024-01-15", "units": 100, "nav": 150.5, "amount": 15050, "transaction_type": "buy" }
      ]
    }
  ]
}
```

Fund types: `mutual_fund`, `stock`, `fd`, `ppf`, `epf`

## External APIs

- **MFAPI** (`https://api.mfapi.in/`) -- Free, no auth. Mutual fund NAV and search.
- **Yahoo Finance** (`yfinance` Python lib + direct URL in frontend) -- Stock prices. Append `.NS` for NSE symbols.

## Common Tasks

| Task | Where to change |
|------|----------------|
| Add new fund type | Backend: add Pydantic model fields + endpoints. Frontend: `fundUtils.js` type detection, relevant components |
| Add new chart | Backend: new `/api/charts/` endpoint. Frontend: add to `Charts.jsx` using Recharts |
| Add new metric | `calculations.js` (client-side) or backend metrics functions |
| Change theme | `frontend/src/index.css` (CSS variables) + `tailwind.config.js` |
| Add new tab/page | `App.jsx` -- add to tabs array and render section |
