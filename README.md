# Microtechnique Accounts — Smart Accounts for Indian Businesses

A comprehensive business management platform built for Indian MSMEs — traders, retailers, manufacturers, distributors, and service businesses. Direct competitor to Vyapar.

## 🚀 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js 20 + TypeScript + Express + Zod |
| **Database** | PostgreSQL 15 + Redis 7 |
| **Frontend** | React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui |
| **State** | Zustand + TanStack Query v5 |
| **PDF** | Puppeteer (server-side) |
| **Queue** | BullMQ on Redis |
| **Auth** | JWT (access 15min, refresh 7 days) |
| **Files** | Local /uploads (S3-compatible interface) |

## 📦 Modules

- **Auth & Users** — Multi-role access (super_admin → staff)
- **Item Master** — Products, services, inventory tracking, barcodes
- **Parties** — Customers & suppliers unified
- **Sales** — Invoices, quotations, credit/debit notes
- **Purchases** — POs, supplier bills, GRN
- **Payments** — Receipts & payment entries with allocation
- **Inventory** — Multi-godown, stock transfers, adjustments, batches, serials
- **Accounting** — Chart of accounts, journal entries, expenses
- **HR** — Employee profiles, attendance, leave management
- **Notifications** — WhatsApp + SMS via Twilio
- **Audit** — Complete activity trail

## 🏁 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+

### Using Docker (recommended)
```bash
docker-compose up -d
```

### Without Docker
```bash
# 1. Start PostgreSQL & Redis locally

# 2. Backend
cd backend
cp .env.example .env
# Edit .env: JWT_SECRET and JWT_REFRESH_SECRET must each be at least 32 characters.
npm install
npm run migrate
npm run seed   # optional: verifies DB connectivity (no demo rows inserted)
npm run dev

# 3. Frontend
cd frontend
npm install
npm run dev
```

### Access
- **Frontend (dev):** http://localhost:3000
- **Frontend (Docker compose):** http://localhost:8080 (nginx → `/api` proxied to backend)
- **API:** http://localhost:5000
- **Health:** http://localhost:5000/health

### Background worker (BullMQ)
```bash
cd backend
npm run worker
```
Starts stub processors for scheduled queues (`overdueInvoiceReminder`, `lowStockAlert`, etc.). Wire real job payloads when schedulers are added.

### Environment variables (backend)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis URL (refresh sessions + BullMQ) |
| `JWT_SECRET` | Yes | Access token signing secret (**≥32 chars**) |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing secret (**≥32 chars**) |
| `JWT_ACCESS_EXPIRY` | No | Default `15m` |
| `JWT_REFRESH_EXPIRY` | No | Default `7d` |
| `EINVOICE_MODE` | No | `mock` (default), `sandbox`, or `production` |
| `EINVOICE_USERNAME` / `EINVOICE_PASSWORD` | For GSP | Fallback GSP credentials if not stored per company |
| `EINVOICE_GSP_URL` | Sandbox/prod | GSP base URL (proxies NIC) |
| `EINVOICE_SANDBOX_URL` | No | Override NIC sandbox host |
| `EINVOICE_PRODUCTION_URL` | No | Override NIC production host |
| `CREDENTIALS_ENCRYPTION_KEY` | No | 64 hex chars (32 bytes) for AES-GCM of stored GSP password |
| `UPLOAD_DIR` | No | Local uploads root (default `./uploads`) |
| `PUPPETEER_EXECUTABLE_PATH` | Docker | e.g. `/usr/bin/chromium-browser` |
| `FRONTEND_URL` | No | Used when building absolute links in PDFs |
| `TWILIO_*` | No | WhatsApp/SMS when configured |

### Production deployment (Ubuntu 22.04)

1. Install Node 20, PostgreSQL 15, Redis 7, PM2 (`npm i -g pm2`).
2. Clone repo, configure `backend/.env` (strong JWT secrets, `DATABASE_URL`, `REDIS_URL`).
3. Run `deploy.sh` from the repo root (adjust paths/sudo as needed), or manually:
   - `cd backend && npm ci && npm run build && npm run migrate`
   - `cd frontend && npm ci && npm run build` and sync `frontend/dist` to nginx `root` (for example, the configured web root on your server).
4. `pm2 reload ecosystem.config.js --env production` — runs API (cluster) + `worker.js`.

Docker production: `docker compose up -d --build` after setting `backend/.env`. Backend image runs `node dist/server.js` with Chromium for PDFs.

### Railway deployment (Docker, full-stack single service)

This repo includes a **root `Dockerfile`** that builds and serves:
- backend API (`/api/*`)
- frontend SPA (all non-API routes)

1. Create a new Railway service from this repo (Railway auto-detects the root `Dockerfile`).
2. Set required env vars:
   - `DATABASE_URL`
   - `REDIS_URL`
   - `JWT_SECRET` (>= 32 chars)
   - `JWT_REFRESH_SECRET` (>= 32 chars)
   - optional: `CORS_ORIGIN`, `FRONTEND_URL`, `EINVOICE_*`, `TWILIO_*`
3. Keep `RUN_MIGRATIONS=true` (default) so migrations run automatically at container start.
4. Railway injects `PORT`; app binds to it automatically.
5. Open the Railway public URL:
   - App UI: `/`
   - API: `/api`

Health endpoint for checks: `/health`

### First-time data

There is **no bundled demo company or users**. After `npm run migrate`, create a registrant/company through **Register** (`/register`) and onboarding, or insert rows via SQL for automated tests.

## 💰 Formatting Rules

- **Money:** Indian number system — ₹1,23,456 (not ₹123,456)
- **Large amounts:** ₹12.3L or ₹1.2Cr with tooltip
- **Dates:** DD MMM YYYY (15 Apr 2025)
- **GST:** Always CGST + SGST separately for intrastate
- **Money storage:** Integers in paise (₹1 = 100 paise)
- **Dates storage:** UTC, displayed in IST

## 📐 Database Rules

- All tables have: `id`, `company_id`, `created_at`, `updated_at`, `is_deleted`
- All queries append: `AND is_deleted = false AND company_id = $N`
- Soft deletes only — no hard deletes

## 📄 License

Proprietary — All rights reserved.
