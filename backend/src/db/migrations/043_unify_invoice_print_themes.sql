-- Unify invoice theme IDs across company settings, preview modal, and PDF generation.
-- Legacy document color themes are retired; affected firms fall back to Business Theme 1.

CREATE OR REPLACE FUNCTION migrate_invoice_print_theme(theme_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(NULLIF(theme_value, ''), '')
    WHEN 'business-theme-1' THEN 'business-theme-1'
    WHEN 'business-theme-2' THEN 'business-theme-2'
    WHEN 'business-theme-3' THEN 'business-theme-3'
    WHEN 'business-theme-4' THEN 'business-theme-4'
    WHEN 'landscape-theme-1' THEN 'landscape-theme-1'
    WHEN 'landscape-theme-2' THEN 'landscape-theme-2'
    WHEN 'gst-theme-1' THEN 'gst-theme-1'
    WHEN 'gst-theme-2' THEN 'gst-theme-2'
    WHEN 'gst-theme-3' THEN 'gst-theme-3'
    WHEN 'gst-theme-4' THEN 'gst-theme-4'
    WHEN 'gst-theme-5' THEN 'gst-theme-5'
    WHEN 'tally-theme-1' THEN 'tally-theme-1'
    WHEN 'standard' THEN 'business-theme-1'
    WHEN 'detailed-tax-invoice' THEN 'business-theme-1'
    WHEN 'simple' THEN 'business-theme-2'
    WHEN 'professional-header' THEN 'business-theme-2'
    WHEN 'performa' THEN 'business-theme-3'
    WHEN 'centered-proforma' THEN 'business-theme-3'
    WHEN 'monochrome' THEN 'business-theme-4'
    WHEN 'black-white-standard' THEN 'business-theme-4'
    WHEN 'micro_theme_1' THEN 'gst-theme-1'
    WHEN 'micro_theme_2' THEN 'gst-theme-2'
    WHEN 'micro_theme_3' THEN 'gst-theme-3'
    WHEN 'micro_theme_4' THEN 'gst-theme-4'
    WHEN 'micro_theme_5' THEN 'gst-theme-5'
    WHEN 'landscape_theme_1' THEN 'landscape-theme-1'
    WHEN 'landscape_theme_2' THEN 'landscape-theme-2'
    WHEN 'gst_theme_1' THEN 'gst-theme-1'
    WHEN 'gst_theme_2' THEN 'gst-theme-2'
    WHEN 'gst_theme_3' THEN 'gst-theme-3'
    WHEN 'gst_theme_4' THEN 'gst-theme-4'
    WHEN 'gst_theme_5' THEN 'gst-theme-5'
    WHEN 'gst_theme_6' THEN 'gst-theme-5'
    WHEN 'gst_theme_7' THEN 'gst-theme-5'
    WHEN 'gst_theme_8' THEN 'gst-theme-5'
    WHEN 'gst_theme_9' THEN 'gst-theme-5'
    WHEN 'gst_theme_10' THEN 'tally-theme-1'
    WHEN 'delivery_theme' THEN 'tally-theme-1'
    WHEN 'double_divine' THEN 'tally-theme-1'
    ELSE 'business-theme-1'
  END;
$$;

ALTER TABLE companies ALTER COLUMN invoice_pdf_template SET DEFAULT 'business-theme-1';
ALTER TABLE companies ALTER COLUMN document_theme SET DEFAULT 'business-theme-1';
ALTER TABLE invoices ALTER COLUMN document_theme SET DEFAULT 'business-theme-1';
ALTER TABLE quotations ALTER COLUMN document_theme SET DEFAULT 'business-theme-1';
ALTER TABLE purchase_invoices ALTER COLUMN document_theme SET DEFAULT 'business-theme-1';

UPDATE companies
SET invoice_pdf_template = migrate_invoice_print_theme(invoice_pdf_template),
    document_theme = migrate_invoice_print_theme(document_theme),
    print_settings = jsonb_set(
      jsonb_set(
        COALESCE(print_settings, '{}'::jsonb),
        '{regular}',
        COALESCE(print_settings->'regular', '{}'::jsonb) ||
          jsonb_build_object(
            'layout',
            migrate_invoice_print_theme(COALESCE(print_settings #>> '{regular,layout}', print_settings->>'invoiceTheme', invoice_pdf_template, document_theme))
          ),
        true
      ),
      '{invoiceTheme}',
      to_jsonb(migrate_invoice_print_theme(COALESCE(print_settings #>> '{regular,layout}', print_settings->>'invoiceTheme', invoice_pdf_template, document_theme))),
      true
    ),
    updated_at = NOW()
WHERE invoice_pdf_template IS DISTINCT FROM migrate_invoice_print_theme(invoice_pdf_template)
   OR document_theme IS DISTINCT FROM migrate_invoice_print_theme(document_theme)
   OR COALESCE(print_settings #>> '{regular,layout}', '') IS DISTINCT FROM migrate_invoice_print_theme(COALESCE(print_settings #>> '{regular,layout}', print_settings->>'invoiceTheme', invoice_pdf_template, document_theme));

UPDATE invoices
SET pdf_template = migrate_invoice_print_theme(pdf_template),
    document_theme = migrate_invoice_print_theme(document_theme),
    updated_at = NOW()
WHERE pdf_template IS DISTINCT FROM migrate_invoice_print_theme(pdf_template)
   OR document_theme IS DISTINCT FROM migrate_invoice_print_theme(document_theme);

UPDATE quotations
SET pdf_template = migrate_invoice_print_theme(pdf_template),
    document_theme = migrate_invoice_print_theme(document_theme),
    updated_at = NOW()
WHERE pdf_template IS DISTINCT FROM migrate_invoice_print_theme(pdf_template)
   OR document_theme IS DISTINCT FROM migrate_invoice_print_theme(document_theme);

UPDATE purchase_invoices
SET pdf_template = migrate_invoice_print_theme(pdf_template),
    document_theme = migrate_invoice_print_theme(document_theme),
    updated_at = NOW()
WHERE pdf_template IS DISTINCT FROM migrate_invoice_print_theme(pdf_template)
   OR document_theme IS DISTINCT FROM migrate_invoice_print_theme(document_theme);

DROP FUNCTION migrate_invoice_print_theme(text);
