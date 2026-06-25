-- ═══════════════════════════════════════════════════════════════
-- Migration: 046_alter_barcode_registry.sql
-- Simplify barcode registry to only store item mapping and barcode.
-- ═══════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS barcode_registry;

CREATE SEQUENCE IF NOT EXISTS barcode_num_seq START WITH 1;

CREATE TABLE barcode_registry (
  barcode        varchar(10) PRIMARY KEY,
  item_id        uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX idx_barcode_registry_item ON barcode_registry(item_id);
