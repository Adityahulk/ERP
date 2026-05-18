ALTER TABLE companies
  ALTER COLUMN invoice_pdf_template SET DEFAULT 'monochrome';

ALTER TABLE companies
  ALTER COLUMN document_theme SET DEFAULT 'executive';

UPDATE companies
SET invoice_pdf_template = 'monochrome'
WHERE invoice_pdf_template IS NULL OR invoice_pdf_template = 'standard';

UPDATE companies
SET document_theme = 'executive'
WHERE document_theme IS NULL OR document_theme = 'classic';
