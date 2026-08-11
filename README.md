# Thundocs Trader Dashboard

A serious, versioned crypto paper-trading dashboard.

- **Frontend:** Vite + React + TypeScript (Vercel) — `frontend/`
- **Backend/API + bot:** stdlib-only Python (Render) — `backend/`
- **Data:** Binance **DEMO** (fake money only). No real funds, no paid API.

## Architecture
```
GitHub (this repo)
├── frontend/  → built & served by Vercel (static SPA)
└── backend/   → Render web service (Docker), runs the demo bot + /api/state, /api/fills
```
The frontend calls the backend API via `VITE_API_URL` (set in Vercel env).
Binance demo keys live only in Render env vars / GitHub secrets — never committed.

## Local dev
```bash
# backend (needs testnet_keys.json with demo key/secret)
cd backend && python app.py          # http://localhost:8000/api/state

# frontend
cd frontend && npm install && npm run dev
# set VITE_API_URL=http://localhost:8000 in frontend/.env.local
```

## Deploy
- **Vercel:** import repo, root = `frontend`, set `VITE_API_URL` = your Render URL.
- **Render:** new Web Service from `backend/`, Docker, set env:
  `THUNDOC_BINANCE_KEY`, `THUNDOC_BINANCE_SECRET`, and optionally `PORT=8000`.

## Disclaimer
DEMO trading only. All balances and P&L are simulated. Nothing here constitutes
financial advice.
