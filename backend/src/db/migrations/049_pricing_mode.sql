ALTER TABLE invoices ADD COLUMN pricing_mode TEXT DEFAULT 'exclusive';
ALTER TABLE invoice_items ADD COLUMN price_includes_tax BOOLEAN DEFAULT false;

ALTER TABLE items ADD COLUMN selling_price_includes_tax BOOLEAN DEFAULT false;
ALTER TABLE items ADD COLUMN purchase_price_includes_tax BOOLEAN DEFAULT false;
