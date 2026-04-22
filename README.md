# BizFlow — Smart ERP for Indian Businesses

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
npm install
npm run migrate
npm run seed
npm run dev

# 3. Frontend
cd frontend
npm install
npm run dev
```

### Access
- **Frontend:** http://localhost:3000
- **API:** http://localhost:5000
- **Health:** http://localhost:5000/health

### Demo Credentials
| Email | Password | Role |
|-------|----------|------|
| admin@demo.com | Demo@1234 | Company Admin |
| accountant@demo.com | Demo@1234 | Accountant |
| manager@demo.com | Demo@1234 | Manager |
| cashier@demo.com | Demo@1234 | Cashier |
| staff@demo.com | Demo@1234 | Staff |

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
