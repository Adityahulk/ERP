-- Migration: 002_party_ledger_expenses_schema.sql

-- Add missing columns to parties
ALTER TABLE parties
ADD COLUMN IF NOT EXISTS city varchar(200),
ADD COLUMN IF NOT EXISTS state varchar(200),
ADD COLUMN IF NOT EXISTS pincode varchar(10),
ADD COLUMN IF NOT EXISTS state_code varchar(5),
ADD COLUMN IF NOT EXISTS payment_terms integer DEFAULT 30,
ADD COLUMN IF NOT EXISTS balance integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS contact_person varchar(200),
ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}';

-- Create party ledger table
CREATE TABLE IF NOT EXISTS party_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  party_id        uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  type            varchar(20) NOT NULL, -- 'debit' or 'credit'
  amount          integer NOT NULL,
  balance_after   integer NOT NULL,
  reference_type  varchar(50),
  reference_id    uuid,
  narration       text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_party_ledger_party_time ON party_ledger(party_id, created_at desc);

-- Update expenses table
ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS reference_number varchar(200),
ADD COLUMN IF NOT EXISTS is_reimbursable boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS gst_amount integer DEFAULT 0;
