-- ═══════════════════════════════════════════════════════════════
-- Migration: 045_barcode_registry.sql
-- Audit log for every label print event from the Label Editor.
-- Records who printed, what item, which smart barcode was used,
-- how many copies, and in which format.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE barcode_registry (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  item_id        uuid NOT NULL REFERENCES items(id),

  -- Full smart barcode string printed on the label (e.g. "SC|company-uuid|item-uuid")
  -- NULL when printed from the legacy bulk-print path (no label editor)
  smart_barcode  varchar(100),

  -- How many physical copies were printed in this event
  copies_printed integer NOT NULL DEFAULT 1,

  -- Which label format was used
  -- Values: 'a4_24', 'a4_40', 'a4_65', 'thermal_single', 'thermal_double'
  print_format   varchar(20),

  printed_at     timestamptz DEFAULT now()
);

CREATE INDEX idx_barcode_registry_company ON barcode_registry(company_id, printed_at DESC);
CREATE INDEX idx_barcode_registry_item    ON barcode_registry(item_id);
CREATE INDEX idx_barcode_registry_user    ON barcode_registry(user_id);
