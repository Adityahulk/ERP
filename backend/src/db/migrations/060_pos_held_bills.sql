-- ═══════════════════════════════════════════════════════════════
-- Migration: 060_pos_held_bills.sql
--
-- Real persistence for Hold/Park Bill — a held bill needs to survive
-- a browser refresh or even be resumable from a different terminal
-- by another cashier, which localStorage alone can't do.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE pos_held_bills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  godown_id       uuid REFERENCES godowns(id), -- counter/location
  label           varchar(100), -- e.g. "Table 4" or customer name, cashier-assigned
  party_id        uuid REFERENCES parties(id),
  party_name      varchar(255), -- snapshot, since a held bill's customer may not be a saved party yet
  cart_json       jsonb NOT NULL, -- the real line-item array, same shape the checkout payload uses
  held_by         uuid REFERENCES users(id),
  status          varchar(20) NOT NULL DEFAULT 'held', -- held | resumed | voided
  created_at      timestamptz NOT NULL DEFAULT now(),
  resumed_at      timestamptz
);
CREATE INDEX idx_pos_held_bills_company ON pos_held_bills(company_id, status, created_at DESC);
