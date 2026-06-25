-- E-invoice & print-related company settings
ALTER TABLE companies ADD COLUMN einvoice_enabled boolean DEFAULT false;
ALTER TABLE companies ADD COLUMN einvoice_turnover_above_5cr boolean DEFAULT false;
ALTER TABLE companies ADD COLUMN einvoice_sandbox boolean DEFAULT true;
ALTER TABLE companies ADD COLUMN einvoice_gsp_username varchar(200);
ALTER TABLE companies ADD COLUMN einvoice_gsp_password_enc text;
ALTER TABLE companies ADD COLUMN document_primary_color varchar(20) DEFAULT '#4F46E5';
ALTER TABLE companies ADD COLUMN receipt_footer_message text;
ALTER TABLE companies ADD COLUMN invoice_pdf_template varchar(30) DEFAULT 'standard';

COMMENT ON COLUMN companies.einvoice_gsp_password_enc IS 'AES-256-GCM ciphertext (base64), never returned to clients';
