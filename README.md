# Portfolio Tracker

A privacy-focused portfolio tracking app for Indian mutual funds, stocks, FDs, PPF, and EPF. All data stays local -- only NAV/prices are fetched from public APIs.

## Features

- **Multi-account tracking** -- Organize investments across brokerages (Zerodha, Groww, etc.)
- **Mutual fund search** -- Search 40,000+ Indian mutual funds by name, auto-fill scheme codes
- **Auto NAV fetch** -- Current NAV from [MFAPI](https://www.mfapi.in/) (mutual funds) and Yahoo Finance (stocks)
- **XIRR & returns** -- Annualized returns considering timing of cash flows, absolute P&L, day change
- **FD/PPF/EPF support** -- Track fixed deposits with maturity calculation, PPF and EPF balances
- **Interactive charts** -- Portfolio timeline, allocation breakdown, fund performance comparisons
- **Fund insights** -- Overlap analysis, portfolio X-ray, scoring engine, benchmark comparisons
- **Realized gains** -- Track sell transactions and capital gains separately
- **Dark/Light theme** -- Toggle between dark and light mode
- **PWA / iOS** -- Installable as a Progressive Web App; Capacitor config for native iOS builds

## Tech Stack

| Layer | Stack |
|-------|-------|
| Backend | Python 3.8+, FastAPI, SciPy (XIRR), httpx, yfinance |
| Frontend | React 18, Vite, TailwindCSS, Recharts, Framer Motion |
| Storage | Local JSON file (backend) / IndexedDB (standalone PWA mode) |

## Quick Start

```bash
# Clone and start everything
./start.sh
```

Or manually:

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python main.py
# -> http://localhost:8000

# Frontend
cd frontend
npm install
npm run dev
# -> http://localhost:3000
```

## Project Structure

```
portfolio-tracker/
├── backend/
│   ├── main.py              # FastAPI app (all endpoints)
│   ├── requirements.txt
│   └── data/                # Auto-created; holds portfolio.json (gitignored)
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Root component with v1/v2 routing
│   │   ├── components/      # UI components + ui/ primitives
│   │   └── lib/             # API client, calculations, utilities
│   ├── public/              # PWA manifest + service worker
│   ├── index.html
│   ├── vite.config.js
│   └── tailwind.config.js
├── SAMPLE_DATA.json         # Example portfolio for testing
├── start.sh                 # One-command launcher
└── .gitignore
```

## Usage

1. **Create accounts** -- Add your brokerage/platform accounts (Accounts tab)
2. **Add investments** -- Search and add mutual funds or stocks (Investments tab)
3. **Record transactions** -- Log buy/sell with date, units, NAV (Transactions)
4. **Update NAV** -- Click refresh to auto-fetch latest prices
5. **View dashboard** -- See portfolio summary, XIRR, day change, charts

## API Overview

| Endpoint | Description |
|----------|-------------|
| `GET /api/dashboard` | Full portfolio summary with metrics |
| `GET/POST /api/accounts` | List or create accounts |
| `GET/POST /api/funds` | List or create funds |
| `POST /api/transactions` | Add a transaction |
| `POST /api/funds/{id}/update-nav` | Auto-fetch current NAV |
| `GET /api/nav/search/mutual-fund/{name}` | Search mutual funds |
| `GET /api/charts/portfolio-timeline` | Portfolio value over time |
| `GET /api/charts/account-allocation` | Allocation breakdown |
| `GET /api/charts/fund-performance` | Fund performance comparison |

Full API docs available at `http://localhost:8000/docs` (Swagger UI) when the backend is running.

## Data & Privacy

- All portfolio data stored locally in `backend/data/portfolio.json`
- No authentication, no cloud storage, no telemetry
- External calls only fetch public NAV/price data (fund codes/symbols sent, never your amounts)
- Data file is gitignored -- back it up manually

## Sample Data

Import `SAMPLE_DATA.json` from the Settings page to try the app with demo data.

## License

MIT
