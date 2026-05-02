-- ═══════════════════════════════════════════════════════════════
-- Super admin: nullable company_id on users & audit_logs, platform user seed
-- ═══════════════════════════════════════════════════════════════

-- Allow platform-level users and audit entries without a tenant company
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_company_id_fkey;
ALTER TABLE users ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE users
  ADD CONSTRAINT users_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_company_id_fkey;
ALTER TABLE audit_logs ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id);

-- At most one platform user per email (Postgres treats NULLs as distinct in multi-column uniques)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_platform_email
  ON users (lower(email))
  WHERE company_id IS NULL AND email IS NOT NULL AND is_deleted = false;

-- Super admin (password: SuperAdmin@2024) — idempotent
INSERT INTO users (company_id, name, email, password_hash, role, is_active)
SELECT NULL, 'Super Admin', 'superadmin@microtechnique.in',
       '$2a$12$3PnyYnA4LnIgK3gZK4vsyu2D5OGgyNPhn7tnkFdLm/Z3baHpFsp4u',
       'super_admin', true
WHERE NOT EXISTS (
  SELECT 1 FROM users u
  WHERE u.company_id IS NULL
    AND lower(u.email) = 'superadmin@microtechnique.in'
    AND u.is_deleted = false
);
