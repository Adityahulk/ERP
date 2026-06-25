-- ═══════════════════════════════════════════════════════════════
-- Migration: 054_cash_bank_enterprise_upgrade.sql
--
-- The Cash & Bank module already has real infrastructure: bank
-- accounts (company_bank_accounts), loan accounts + transactions,
-- and cheque tracking via payments.payment_mode='cheque' with a
-- signed-ledger system feeding cash/bank balances and the journal
-- (postPaymentAccounting). This migration extends that real
-- foundation rather than building a parallel system next to it.
-- ═══════════════════════════════════════════════════════════════

-- 1. Bank Accounts — account type, opening balance/date, notes, and
--    the three print/online-payment toggles from the brief.
ALTER TABLE company_bank_accounts
  ADD COLUMN IF NOT EXISTS account_type varchar(20) NOT NULL DEFAULT 'current', -- savings | current | credit_card | wallet | upi
  ADD COLUMN IF NOT EXISTS opening_balance bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS print_on_invoice boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS print_upi_qr boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accept_online_payments boolean NOT NULL DEFAULT false;

-- 2. Cheques — payments already has cheque_number/instrument_date/
--    clearance_status; add the two missing lifecycle dates so the
--    full Pending -> Deposited -> Cleared/Bounced timeline is real.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS cheque_deposit_date date,
  ADD COLUMN IF NOT EXISTS cheque_clearance_date date,
  ADD COLUMN IF NOT EXISTS cheque_bounce_reason text;

-- 3. Loan Accounts — EMI/term/processing-fee fields the brief asks
--    for, plus which cash/bank account the loan was actually
--    received into (so disbursement can correctly credit that
--    account instead of being accounting-invisible, which was a
--    real pre-existing gap: loan_transactions never touched the
--    journal at all before this).
ALTER TABLE loan_accounts
  ADD COLUMN IF NOT EXISTS loan_type varchar(30), -- term_loan | overdraft | line_of_credit | vehicle_loan | other
  ADD COLUMN IF NOT EXISTS emi_amount bigint,
  ADD COLUMN IF NOT EXISTS term_months integer,
  ADD COLUMN IF NOT EXISTS processing_fee bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_in varchar(20) DEFAULT 'bank', -- cash | bank | upi
  ADD COLUMN IF NOT EXISTS company_bank_account_id uuid REFERENCES company_bank_accounts(id);

ALTER TABLE loan_transactions
  ADD COLUMN IF NOT EXISTS company_bank_account_id uuid REFERENCES company_bank_accounts(id);

-- 4. Bank Transfers — a real audited record of moving funds between
--    cash and/or specific bank accounts (cash<->bank already existed
--    via createCashBankAdjustment; this generalizes to bank<->bank
--    and gives transfers their own queryable list/report instead of
--    being indistinguishable from other payments rows).
CREATE TABLE bank_transfers (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  from_account_id         uuid REFERENCES company_bank_accounts(id), -- NULL = cash in hand
  to_account_id           uuid REFERENCES company_bank_accounts(id), -- NULL = cash in hand
  amount                  bigint NOT NULL,
  transfer_date           date NOT NULL DEFAULT CURRENT_DATE,
  reference_number        varchar(100),
  notes                   text,
  from_payment_id         uuid REFERENCES payments(id),
  to_payment_id           uuid REFERENCES payments(id),
  created_by              uuid REFERENCES users(id),
  is_deleted              boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bank_transfers_company ON bank_transfers(company_id, transfer_date DESC, is_deleted);

-- 5. Bank Reconciliation — upload a statement (CSV/Excel, parsed
--    client- or server-side into rows), then match each line against
--    a real payments row. Genuinely new — no prior version existed.
CREATE TABLE bank_reconciliations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  company_bank_account_id uuid NOT NULL REFERENCES company_bank_accounts(id),
  statement_from_date date NOT NULL,
  statement_to_date   date NOT NULL,
  opening_balance     bigint NOT NULL DEFAULT 0,
  closing_balance     bigint NOT NULL DEFAULT 0,
  status              varchar(20) NOT NULL DEFAULT 'in_progress', -- in_progress | completed
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);

CREATE TABLE bank_reconciliation_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES bank_reconciliations(id) ON DELETE CASCADE,
  statement_date    date NOT NULL,
  description       text,
  amount            bigint NOT NULL, -- positive = credit (money in), negative = debit (money out)
  matched_payment_id uuid REFERENCES payments(id),
  status            varchar(20) NOT NULL DEFAULT 'unmatched', -- unmatched | matched | ignored
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_reconciliations_company ON bank_reconciliations(company_id, company_bank_account_id);
CREATE INDEX idx_bank_reconciliation_lines_recon ON bank_reconciliation_lines(reconciliation_id, status);
