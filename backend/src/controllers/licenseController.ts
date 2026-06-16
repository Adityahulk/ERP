import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { clearTierFeaturesCache } from '../middleware/moduleGuard';

const CONTACT_PHONE = '+91 6355 997 080';
const CONTACT_EMAIL = 'support@microtechnique.in';
const PAYMENT_UPI_ID = process.env.PAYMENT_UPI_ID || '';
const PAYMENT_PAYEE_NAME = process.env.PAYMENT_PAYEE_NAME || 'Microtechnique Accounts';
const TRIAL_DAYS = 15;

function buildUpiDeepLink(amountInr: number, note: string): string | null {
  if (!PAYMENT_UPI_ID) return null;
  const params = new URLSearchParams({
    pa: PAYMENT_UPI_ID,
    pn: PAYMENT_PAYEE_NAME,
    am: String(amountInr),
    cu: 'INR',
    tn: note.slice(0, 80),
  });
  return `upi://pay?${params.toString()}`;
}

async function enforceCurrentTierPrices() {
  await query(
    `UPDATE license_tiers
     SET price_inr = CASE name
       WHEN 'silver' THEN 9999
       WHEN 'gold' THEN 18999
       WHEN 'diamond' THEN 30999
       ELSE price_inr
     END,
     updated_at = NOW()
     WHERE name IN ('silver', 'gold', 'diamond')
       AND price_inr IS DISTINCT FROM CASE name
         WHEN 'silver' THEN 9999
         WHEN 'gold' THEN 18999
         WHEN 'diamond' THEN 30999
         ELSE price_inr
       END`
  );
}

// ── GET /api/licenses/tiers ───────────────────────────────────
// Public — returns all active tiers with features
export async function getLicenseTiers(req: Request, res: Response) {
  try {
    await enforceCurrentTierPrices();
    const tiersResult = await query(
      `SELECT id, name, display_name, max_users, price_inr, description, sort_order
       FROM license_tiers
       WHERE is_active = true
       ORDER BY sort_order ASC`
    );

    const featuresResult = await query(
      `SELECT tier_id, feature_key, feature_label, is_included, sort_order
       FROM license_tier_features
       ORDER BY tier_id, sort_order ASC`
    );

    // Attach features to each tier
    const tiers = tiersResult.rows.map(tier => ({
      ...tier,
      features: featuresResult.rows
        .filter(f => f.tier_id === tier.id)
        .map(f => ({
          key: f.feature_key,
          label: f.feature_label,
          included: f.is_included,
        })),
    }));

    res.json(success({ tiers, contact: { phone: CONTACT_PHONE, email: CONTACT_EMAIL } }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/licenses/request ────────────────────────────────
// Authenticated registrant — create a pending license for a chosen tier
export async function requestLicense(req: Request, res: Response) {
  try {
    await enforceCurrentTierPrices();
    const registrantId = req.registrant!.id;
    const { tier_id } = req.body;

    if (!tier_id) {
      return res.status(400).json(error('tier_id is required'));
    }

    // Validate tier exists
    const tierResult = await query(
      'SELECT id, name, display_name, max_users, price_inr FROM license_tiers WHERE id = $1 AND is_active = true',
      [tier_id]
    );
    if (!tierResult.rows.length) {
      return res.status(404).json(error('License tier not found'));
    }

    const tier = tierResult.rows[0];

    // Create pending license
    const result = await query(
      `INSERT INTO licenses (registrant_id, tier_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, license_key, status, requested_at`,
      [registrantId, tier_id]
    );

    const license = result.rows[0];
    const upiLink = buildUpiDeepLink(Number(tier.price_inr || 0), `BizFlow ${tier.display_name} ${license.license_key}`);

    res.status(201).json(success({
      license: { ...license, tier },
      contact: { phone: CONTACT_PHONE, email: CONTACT_EMAIL },
      payment: upiLink
        ? {
            mode: 'upi',
            upi_link: upiLink,
            upi_id: PAYMENT_UPI_ID,
            amount_inr: Number(tier.price_inr || 0),
          }
        : null,
      message: `Your license request for the ${tier.display_name} plan has been received. Please contact us at ${CONTACT_PHONE} or ${CONTACT_EMAIL} to complete payment and activate your license.`,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/licenses/start-trial ────────────────────────────
// Authenticated registrant — provision a full Diamond trial company after email verification
export async function startTrialLicense(req: Request, res: Response) {
  try {
    await enforceCurrentTierPrices();
    const registrantId = req.registrant!.id;
    const requestedBusinessName = typeof req.body?.business_name === 'string' ? req.body.business_name.trim() : '';

    const registrantResult = await query(
      `SELECT id, name, email, phone, password_hash, is_active, email_verified_at
       FROM registrants
       WHERE id = $1 AND is_deleted = false
       LIMIT 1`,
      [registrantId]
    );
    if (!registrantResult.rows.length) {
      return res.status(404).json(error('Registrant not found'));
    }

    const registrant = registrantResult.rows[0];
    if (!registrant.is_active) {
      return res.status(403).json(error('Your account has been deactivated. Please contact support.'));
    }
    if (!registrant.email_verified_at) {
      return res.status(403).json(error('Please verify your email before starting a trial.'));
    }

    const activeTrialResult = await query(
      `SELECT l.id, l.license_key, l.status, l.expires_at,
              c.id AS company_id, c.name AS company_name
       FROM licenses l
       LEFT JOIN companies c ON c.id = l.company_id AND c.is_deleted = false
       WHERE l.registrant_id = $1
         AND l.status = 'trial'
         AND l.is_deleted = false
         AND (l.expires_at IS NULL OR l.expires_at > NOW())
       ORDER BY l.created_at DESC
       LIMIT 1`,
      [registrantId]
    );
    if (activeTrialResult.rows.length) {
      return res.status(409).json({
        success: false,
        error: 'You already have an active trial.',
        data: { license: activeTrialResult.rows[0] },
      });
    }

    const tierResult = await query(
      `SELECT id, name, display_name, max_users, price_inr
       FROM license_tiers
       WHERE name = 'diamond' AND is_active = true
       LIMIT 1`
    );
    if (!tierResult.rows.length) {
      return res.status(500).json(error('Trial configuration error. Please contact support.'));
    }

    const tier = tierResult.rows[0];
    const trialExpiresAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const companyName = requestedBusinessName || `${registrant.name}'s Business`;

    const result = await withTransaction(async (client) => {
      const licRes = await client.query(
        `INSERT INTO licenses (registrant_id, tier_id, status, activated_at, expires_at, notes)
         VALUES ($1, $2, 'trial', NOW(), $3, 'Self-serve 15-day Diamond free trial')
         RETURNING id, license_key, status, activated_at, expires_at, requested_at`,
        [registrant.id, tier.id, trialExpiresAt]
      );
      const license = licRes.rows[0];

      const companyRes = await client.query(
        `INSERT INTO companies (name, email, phone, license_id, plan_type, plan_expires_at)
         VALUES ($1, $2, $3, $4, 'trial', $5)
         RETURNING id, name, email, phone`,
        [companyName, registrant.email, registrant.phone || null, license.id, trialExpiresAt]
      );
      const company = companyRes.rows[0];

      await client.query(
        `UPDATE licenses SET company_id = $1, updated_at = NOW() WHERE id = $2`,
        [company.id, license.id]
      );

      const userRes = await client.query(
        `INSERT INTO users (company_id, name, email, phone, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, $5, 'company_admin', true)
         RETURNING id, name, email, role`,
        [company.id, registrant.name, registrant.email, registrant.phone || null, registrant.password_hash]
      );

      return {
        license: { ...license, tier, company_id: company.id, company_name: company.name },
        company,
        admin_user: userRes.rows[0],
      };
    });

    res.status(201).json(success({
      message: 'Your 15-day full Diamond trial is active.',
      license: result.license,
      company: result.company,
      admin_user: result.admin_user,
      trial_expires_at: trialExpiresAt,
      trial_days_remaining: TRIAL_DAYS,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/licenses ─────────────────────────────────────────
// Authenticated registrant — list all their licenses
export async function getMyLicenses(req: Request, res: Response) {
  try {
    const registrantId = req.registrant!.id;

    const result = await query(
      `SELECT l.id, l.license_key, l.status, l.activated_at, l.expires_at, l.requested_at, l.notes,
              lt.name as tier_name, lt.display_name as tier_display_name,
              lt.max_users, lt.price_inr,
              c.id as company_id, c.name as company_name,
              (SELECT COUNT(*) FROM users u
               WHERE u.company_id = c.id AND u.is_deleted = false AND u.is_active = true
              ) as active_users
       FROM licenses l
       JOIN license_tiers lt ON lt.id = l.tier_id
       LEFT JOIN companies c ON c.id = l.company_id
       WHERE l.registrant_id = $1 AND l.is_deleted = false
       ORDER BY l.created_at DESC`,
      [registrantId]
    );

    res.json(success({ licenses: result.rows }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/licenses/:id ─────────────────────────────────────
// Authenticated registrant — get single license detail with users
export async function getLicenseDetail(req: Request, res: Response) {
  try {
    const registrantId = req.registrant!.id;
    const { id } = req.params;

    const licResult = await query(
      `SELECT l.id, l.license_key, l.status, l.activated_at, l.expires_at, l.requested_at, l.notes,
              lt.name as tier_name, lt.display_name as tier_display_name,
              lt.max_users, lt.price_inr,
              c.id as company_id, c.name as company_name, c.email as company_email, c.phone as company_phone
       FROM licenses l
       JOIN license_tiers lt ON lt.id = l.tier_id
       LEFT JOIN companies c ON c.id = l.company_id
       WHERE l.id = $1 AND l.registrant_id = $2 AND l.is_deleted = false`,
      [id, registrantId]
    );

    if (!licResult.rows.length) {
      return res.status(404).json(error('License not found'));
    }

    const license = licResult.rows[0];

    // Fetch features for this tier
    const featuresResult = await query(
      `SELECT feature_key, feature_label, is_included
       FROM license_tier_features
       WHERE tier_id = (SELECT tier_id FROM licenses WHERE id = $1)
       ORDER BY sort_order ASC`,
      [id]
    );

    // Fetch associated users if company exists
    let users: any[] = [];
    if (license.company_id) {
      const usersResult = await query(
        `SELECT id, name, email, role, is_active, last_login_at, created_at
         FROM users
         WHERE company_id = $1 AND is_deleted = false
         ORDER BY created_at ASC`,
        [license.company_id]
      );
      users = usersResult.rows;
    }

    res.json(success({
      license: {
        ...license,
        features: featuresResult.rows.map(f => ({
          key: f.feature_key,
          label: f.feature_label,
          included: f.is_included,
        })),
      },
      users,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/admin/licenses/:id/activate ────────────────────
// Super-admin only — activate a pending license, provision company + users
export async function activateLicense(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { company_name, admin_name, admin_email, admin_password, expires_days, notes } = req.body;

    if (!company_name || !admin_name || !admin_email || !admin_password) {
      return res.status(400).json(error('company_name, admin_name, admin_email, and admin_password are required'));
    }

    // Fetch the license
    const licResult = await query(
      `SELECT l.*, lt.name as tier_name, lt.max_users, lt.display_name as tier_display_name
       FROM licenses l
       JOIN license_tiers lt ON lt.id = l.tier_id
       WHERE l.id = $1 AND l.is_deleted = false`,
      [id]
    );

    if (!licResult.rows.length) {
      return res.status(404).json(error('License not found'));
    }

    const license = licResult.rows[0];

    if (license.status !== 'pending') {
      return res.status(400).json(error(`License is already ${license.status}`));
    }

    const expiresAt = expires_days
      ? new Date(Date.now() + parseInt(expires_days) * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // default 1 year

    const passwordHash = await bcrypt.hash(admin_password, 12);

    const result = await withTransaction(async (client) => {
      // 1. Create company
      const companyRes = await client.query(
        `INSERT INTO companies (name, license_id)
         VALUES ($1, $2)
         RETURNING id, name`,
        [company_name.trim(), id]
      );
      const company = companyRes.rows[0];

      // 2. Create admin user for that company
      const userRes = await client.query(
        `INSERT INTO users (company_id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, 'company_admin')
         RETURNING id, name, email, role`,
        [company.id, admin_name.trim(), admin_email.toLowerCase().trim(), passwordHash]
      );
      const adminUser = userRes.rows[0];

      // 3. Activate the license — link it to the company
      await client.query(
        `UPDATE licenses
         SET status = 'active', company_id = $1, activated_at = NOW(),
             expires_at = $2, notes = $3, updated_at = NOW()
         WHERE id = $4`,
        [company.id, expiresAt, notes || null, id]
      );

      return { company, adminUser };
    });

    res.json(success({
      message: `License activated successfully for ${company_name}`,
      company: result.company,
      admin_user: result.adminUser,
      admin_password,
      license_key: license.license_key,
      tier: license.tier_display_name,
      max_users: license.max_users,
      expires_at: expiresAt,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/admin/licenses ───────────────────────────────────
// Super-admin — view all licenses with registrant & company info
export async function adminListLicenses(req: Request, res: Response) {
  try {
    const { status } = req.query;

    let whereClause = 'WHERE l.is_deleted = false';
    const params: any[] = [];
    if (status) {
      params.push(status);
      whereClause += ` AND l.status = $${params.length}`;
    }

    const result = await query(
      `SELECT l.id, l.license_key, l.status, l.activated_at, l.expires_at, l.requested_at, l.notes,
              lt.name as tier_name, lt.display_name as tier_display_name, lt.max_users,
              r.id as registrant_id, r.name as registrant_name, r.email as registrant_email, r.phone as registrant_phone,
              c.id as company_id, c.name as company_name,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.is_deleted = false AND u.is_active = true) as active_users
       FROM licenses l
       JOIN license_tiers lt ON lt.id = l.tier_id
       JOIN registrants r ON r.id = l.registrant_id
       LEFT JOIN companies c ON c.id = l.company_id
       ${whereClause}
       ORDER BY l.created_at DESC`,
      params
    );

    res.json(success({ licenses: result.rows }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── PUT /api/admin/licenses/:id/revoke ────────────────────────
// Super-admin — revoke an active license
export async function revokeLicense(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { reason } = req.body as { reason?: string };

    const stamp =
      reason && String(reason).trim()
        ? `\n[${new Date().toISOString()}] Revoked: ${String(reason).trim()}`
        : `\n[${new Date().toISOString()}] Revoked`;

    const result = await query(
      `UPDATE licenses
       SET status = 'revoked',
           notes = CASE
             WHEN notes IS NULL OR trim(notes) = '' THEN trim($2::text)
             ELSE trim(notes) || $2::text
           END,
           updated_at = NOW()
       WHERE id = $1 AND status = 'active' AND is_deleted = false
       RETURNING id, license_key, status, company_id`,
      [id, stamp]
    );

    if (!result.rows.length) {
      return res.status(404).json(error('Active license not found'));
    }

    const row = result.rows[0];

    // Deactivate the company so its users can no longer log in
    await query(`UPDATE companies SET is_active = false WHERE license_id = $1`, [id]);

    if (row.company_id) {
      await clearTierFeaturesCache(row.company_id);
    }

    res.json(success({ license: { id: row.id, license_key: row.license_key, status: row.status }, message: 'License revoked and company deactivated' }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
