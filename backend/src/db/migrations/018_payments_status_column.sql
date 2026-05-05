ALTER TABLE payments ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'posted';

