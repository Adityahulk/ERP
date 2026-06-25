-- ═══════════════════════════════════════════════════════════════
-- Migration: 051_purchase_returns_and_accounting_integration.sql
--
-- Purchase Return / Debit Note module did not exist at all (the
-- frontend was writing these into the `expenses` table as a
-- workaround, which never touched stock, supplier balance correctly
-- as a return, or the original bill). This migration adds the real
-- table, mirroring the existing `sale_returns` design exactly.
--
-- It also closes a matching pre-existing gap on the SALES side:
-- `sale_returns` never tracked which godown stock should return to,
-- and had no refund-tracking column despite the original brief
-- explicitly asking for "Refund Tracking" there too.
-- ═══════════════════════════════════════════════════════════════

-- Purchase Returns / Debit Notes
CREATE TABLE purchase_returns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  party_id             uuid REFERENCES parties(id),
  purchase_invoice_id  uuid REFERENCES purchase_invoices(id),
  godown_id            uuid REFERENCES godowns(id),
  debit_note_number    varchar(100) NOT NULL,
  return_date          date NOT NULL DEFAULT CURRENT_DATE,
  reason               text,
  total_amount         bigint NOT NULL DEFAULT 0,
  refund_received      bigint NOT NULL DEFAULT 0,
  party_name_snapshot  varchar(255),
  created_by           uuid REFERENCES users(id),
  is_deleted           boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_return_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id   uuid NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  item_id     uuid REFERENCES items(id),
  item_name   varchar(255) NOT NULL,
  hsn_code    varchar(20),
  unit        varchar(50),
  quantity    numeric(15,3) NOT NULL,
  unit_price  bigint NOT NULL,
  gst_rate    numeric(5,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER purchase_returns_updated_at
  BEFORE UPDATE ON purchase_returns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_purchase_returns_company ON purchase_returns(company_id, return_date, is_deleted);
CREATE INDEX idx_purchase_returns_party   ON purchase_returns(company_id, party_id) WHERE party_id IS NOT NULL;
CREATE INDEX idx_purchase_return_items    ON purchase_return_items(return_id);

-- Close the matching gap on the sales side: refund tracking + which
-- godown stock came back into. Both nullable/zero-default so existing
-- historical sale_returns rows remain valid with no backfill needed.
ALTER TABLE sale_returns ADD COLUMN IF NOT EXISTS refund_given bigint NOT NULL DEFAULT 0;
ALTER TABLE sale_returns ADD COLUMN IF NOT EXISTS godown_id uuid REFERENCES godowns(id);
