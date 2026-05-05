-- Company-level default invoice presentation.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS document_theme varchar(30) DEFAULT 'classic';
