import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';
import { clearTierFeaturesCache } from '../middleware/moduleGuard';

export async function getDashboardStats(req: Request, res: Response) {
  try {
    const statsRes = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM licenses WHERE is_deleted = false) AS total_licenses,
         (SELECT COUNT(*)::int FROM licenses WHERE status = 'pending' AND is_deleted = false) AS pending_licenses,
         (SELECT COUNT(*)::int FROM licenses WHERE status = 'active' AND is_deleted = false) AS active_licenses,
         (SELECT COUNT(*)::int FROM licenses WHERE status = 'trial' AND is_deleted = false AND (expires_at IS NULL OR expires_at > NOW())) AS trial_licenses,
         (SELECT COUNT(*)::int FROM licenses WHERE status = 'trial' AND is_deleted = false AND expires_at <= NOW()) AS expired_trial_licenses,
         (SELECT COUNT(*)::int FROM licenses WHERE status = 'revoked' AND is_deleted = false) AS revoked_licenses,
         (SELECT COUNT(*)::int FROM companies WHERE is_deleted = false) AS total_companies,
         (SELECT COUNT(*)::int FROM users WHERE is_deleted = false AND company_id IS NOT NULL) AS total_users,
         (SELECT COUNT(*)::int FROM registrants WHERE is_deleted = false) AS total_registrants,
         (SELECT COUNT(*)::int FROM registrants WHERE is_deleted = false AND lead_status = 'new') AS new_leads,
         (SELECT COUNT(*)::int FROM registrants WHERE is_deleted = false AND email_verified_at IS NOT NULL) AS verified_registrants,
         (SELECT COALESCE(SUM(lt.price_inr), 0)::bigint
            FROM licenses l
            JOIN license_tiers lt ON lt.id = l.tier_id
            WHERE l.status = 'active' AND l.is_deleted = false) AS revenue_potential`
    );
    const stats = statsRes.rows[0];

    const recentReq = await query(
      `SELECT l.id, l.requested_at,
              r.name AS registrant_name, r.email AS registrant_email, r.phone AS registrant_phone,
              lt.name AS tier_name, lt.display_name AS tier_display_name, lt.max_users AS tier_max_users
       FROM licenses l
       JOIN registrants r ON r.id = l.registrant_id
       JOIN license_tiers lt ON lt.id = l.tier_id
       WHERE l.status = 'pending' AND l.is_deleted = false
       ORDER BY l.requested_at DESC
       LIMIT 5`
    );

    const recentActivity = await query(
      `SELECT * FROM (
         SELECT l.id AS license_id, l.license_key, 'activated'::text AS event_type, l.activated_at AS event_at,
                r.name AS registrant_name, c.name AS company_name
         FROM licenses l
         JOIN registrants r ON r.id = l.registrant_id
         LEFT JOIN companies c ON c.id = l.company_id
         WHERE l.is_deleted = false AND l.activated_at IS NOT NULL
         UNION ALL
         SELECT l.id, l.license_key, 'revoked', l.updated_at,
                r.name, c.name
         FROM licenses l
         JOIN registrants r ON r.id = l.registrant_id
         LEFT JOIN companies c ON c.id = l.company_id
         WHERE l.is_deleted = false AND l.status = 'revoked'
       ) e
       ORDER BY event_at DESC NULLS LAST
       LIMIT 10`
    );

    const recentTrials = await query(
      `SELECT l.id, l.license_key, l.requested_at, l.activated_at, l.expires_at,
              r.name AS registrant_name, r.email AS registrant_email, r.phone AS registrant_phone,
              lt.name AS tier_name, lt.display_name AS tier_display_name, lt.max_users AS tier_max_users,
              c.id AS company_id, c.name AS company_name
       FROM licenses l
       JOIN registrants r ON r.id = l.registrant_id
       JOIN license_tiers lt ON lt.id = l.tier_id
       LEFT JOIN companies c ON c.id = l.company_id
       WHERE l.status = 'trial' AND l.is_deleted = false
       ORDER BY l.expires_at ASC NULLS LAST, l.created_at DESC
       LIMIT 8`
    );

    res.json(
      success({
        ...stats,
        revenue_potential: Number(stats.revenue_potential),
        recent_requests: recentReq.rows,
        recent_trials: recentTrials.rows,
        recent_activity: recentActivity.rows,
      })
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getAllRegistrants(req: Request, res: Response) {
  try {
    const { q, status } = req.query as { q?: string; status?: string };
    const { page, limit, offset } = parsePagination(req.query);
    const conditions = ['r.is_deleted = false'];
    const params: unknown[] = [];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`r.lead_status = $${params.length}`);
    }

    if (q && String(q).trim()) {
      params.push(`%${String(q).trim().toLowerCase()}%`);
      const p = params.length;
      conditions.push(`(
        lower(r.name) LIKE $${p}
        OR lower(r.email) LIKE $${p}
        OR lower(coalesce(r.phone, '')) LIKE $${p}
        OR EXISTS (
          SELECT 1
          FROM licenses sl
          LEFT JOIN companies sc ON sc.id = sl.company_id
          WHERE sl.registrant_id = r.id
            AND sl.is_deleted = false
            AND (
              lower(sl.license_key) LIKE $${p}
              OR lower(coalesce(sc.name, '')) LIKE $${p}
            )
        )
      )`);
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`;
    const countResult = await query(
      `SELECT COUNT(*)::int AS c FROM registrants r ${whereSql}`,
      params,
    );
    const total = countResult.rows[0].c;

    params.push(limit, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const result = await query(
      `SELECT r.id, r.name, r.email, r.phone, r.is_active, r.is_verified,
              r.email_verified_at, r.last_login_at, r.created_at,
              r.lead_status, r.lead_source, r.admin_notes, r.last_contacted_at,
              (SELECT COUNT(*)::int FROM licenses l
               WHERE l.registrant_id = r.id AND l.is_deleted = false) AS license_count,
              (SELECT COUNT(*)::int FROM licenses l
               WHERE l.registrant_id = r.id AND l.is_deleted = false
                 AND l.status IN ('active', 'trial')) AS live_license_count,
              latest.status AS latest_license_status,
              latest.license_id,
              latest.company_id,
              latest.company_name
       FROM registrants r
       LEFT JOIN LATERAL (
         SELECT l.id AS license_id, l.status, c.id AS company_id, c.name AS company_name
         FROM licenses l
         LEFT JOIN companies c ON c.id = l.company_id AND c.is_deleted = false
         WHERE l.registrant_id = r.id AND l.is_deleted = false
         ORDER BY COALESCE(l.activated_at, l.requested_at, l.created_at) DESC
         LIMIT 1
       ) latest ON true
       ${whereSql}
       ORDER BY
         CASE r.lead_status
           WHEN 'new' THEN 0
           WHEN 'qualified' THEN 1
           WHEN 'contacted' THEN 2
           WHEN 'customer' THEN 3
           ELSE 4
         END,
         r.created_at DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params,
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function updateRegistrantLead(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const body = req.body as {
      lead_status?: string;
      admin_notes?: string;
      mark_contacted?: boolean;
      is_active?: boolean;
    };
    const current = await query(
      `SELECT id, name, email, lead_status, admin_notes, last_contacted_at, is_active
       FROM registrants
       WHERE id = $1 AND is_deleted = false`,
      [id],
    );
    if (!current.rows.length) return res.status(404).json(error('Registration not found'));

    const updates: string[] = [];
    const values: unknown[] = [];
    const setValue = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };
    if (body.lead_status !== undefined) setValue('lead_status', body.lead_status);
    if (body.admin_notes !== undefined) setValue('admin_notes', body.admin_notes.trim() || null);
    if (body.is_active !== undefined) setValue('is_active', body.is_active);
    if (body.mark_contacted === true) updates.push('last_contacted_at = NOW()');
    if (!updates.length) return res.status(400).json(error('No changes provided'));
    updates.push('updated_at = NOW()');
    values.push(id);

    const updated = await query(
      `UPDATE registrants
       SET ${updates.join(', ')}
       WHERE id = $${values.length} AND is_deleted = false
       RETURNING id, name, email, phone, lead_status, admin_notes,
                 last_contacted_at, is_active, is_verified, email_verified_at`,
      values,
    );

    await logAction(
      req.user!.id,
      null,
      'update_registrant_lead',
      'registrant',
      id,
      current.rows[0],
      updated.rows[0],
      req.ip,
      req.get('User-Agent'),
    );
    res.json(success({ registrant: updated.rows[0] }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function deleteRegistrantLead(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const deleted = await withTransaction(async (client) => {
      const registrantResult = await client.query(
        `SELECT id, name, email
         FROM registrants
         WHERE id = $1 AND is_deleted = false
         FOR UPDATE`,
        [id],
      );
      if (!registrantResult.rows.length) return null;

      const protectedRecords = await client.query(
        `SELECT COUNT(*)::int AS c
         FROM licenses
         WHERE registrant_id = $1
           AND is_deleted = false
           AND (status IN ('active', 'trial') OR company_id IS NOT NULL)`,
        [id],
      );
      if (protectedRecords.rows[0].c > 0) {
        const err = new Error('Active customers or registrations linked to a company cannot be deleted. Revoke the license or manage the company instead.');
        (err as any).status = 409;
        throw err;
      }

      await client.query(
        `UPDATE licenses
         SET is_deleted = true, updated_at = NOW()
         WHERE registrant_id = $1 AND is_deleted = false`,
        [id],
      );
      await client.query(
        `UPDATE registrants
         SET is_deleted = true, is_active = false, updated_at = NOW()
         WHERE id = $1`,
        [id],
      );
      return registrantResult.rows[0];
    });

    if (!deleted) return res.status(404).json(error('Registration not found'));
    await logAction(
      req.user!.id,
      null,
      'delete_registrant_lead',
      'registrant',
      id,
      deleted,
      { is_deleted: true },
      req.ip,
      req.get('User-Agent'),
    );
    res.json(success({ message: 'Registration deleted', registrant: deleted }));
  } catch (err: any) {
    res.status(err?.status || 500).json(error(err.message));
  }
}

export async function getAllLicenses(req: Request, res: Response) {
  try {
    const { status, q } = req.query as { status?: string; q?: string };
    const { page, limit, offset } = parsePagination(req.query);

    const conditions: string[] = ['l.is_deleted = false'];
    const params: unknown[] = [];

    if (status && status !== 'all') {
      if (status === 'expired_trial') {
        conditions.push(`l.status = 'trial' AND l.expires_at <= NOW()`);
      } else {
        params.push(status);
        conditions.push(`l.status = $${params.length}`);
      }
    }

    if (q && String(q).trim()) {
      params.push(`%${String(q).trim().toLowerCase()}%`);
      const p = params.length;
      conditions.push(`(
        lower(r.name) LIKE $${p} OR lower(r.email) LIKE $${p}
        OR lower(coalesce(r.phone, '')) LIKE $${p}
        OR lower(coalesce(c.name, '')) LIKE $${p}
        OR lower(coalesce(l.license_key, '')) LIKE $${p}
      )`);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*)::int AS c
       FROM licenses l
       JOIN license_tiers lt ON lt.id = l.tier_id
       JOIN registrants r ON r.id = l.registrant_id
       LEFT JOIN companies c ON c.id = l.company_id
       ${whereSql}`,
      params
    );
    const total = countRes.rows[0].c;

    params.push(limit, offset);
    const limIdx = params.length - 1;
    const offIdx = params.length;

    const result = await query(
      `SELECT l.id, l.license_key, l.status, l.tier_id, l.requested_at, l.activated_at, l.expires_at, l.notes,
              r.name AS registrant_name, r.email AS registrant_email, r.phone AS registrant_phone,
              lt.name AS tier_name, lt.display_name AS tier_display_name, lt.price_inr AS tier_price_inr,
              lt.max_users AS tier_max_users,
              c.id AS company_id, c.name AS company_name, c.email AS company_email, c.gstin AS company_gstin,
              (SELECT COUNT(*)::int FROM users u
               WHERE u.company_id = c.id AND u.is_deleted = false AND u.is_active = true) AS user_count
       FROM licenses l
       JOIN license_tiers lt ON lt.id = l.tier_id
       JOIN registrants r ON r.id = l.registrant_id
       LEFT JOIN companies c ON c.id = l.company_id
       ${whereSql}
       ORDER BY l.created_at DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      params
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getLicenseDetailSuper(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const licResult = await query(
      `SELECT l.*,
              lt.name AS tier_name, lt.display_name AS tier_display_name, lt.max_users AS tier_max_users,
              lt.price_inr AS tier_price_inr,
              r.name AS registrant_name, r.email AS registrant_email, r.phone AS registrant_phone,
              c.id AS company_id, c.name AS company_name, c.email AS company_email, c.gstin AS company_gstin,
              c.registered_address, c.city, c.state, c.pincode, c.is_active AS company_is_active
       FROM licenses l
       JOIN license_tiers lt ON lt.id = l.tier_id
       JOIN registrants r ON r.id = l.registrant_id
       LEFT JOIN companies c ON c.id = l.company_id
       WHERE l.id = $1 AND l.is_deleted = false`,
      [id]
    );

    if (!licResult.rows.length) {
      return res.status(404).json(error('License not found'));
    }

    const row = licResult.rows[0];

    const featuresResult = await query(
      `SELECT feature_key, feature_label, is_included
       FROM license_tier_features
       WHERE tier_id = $1
       ORDER BY sort_order ASC`,
      [row.tier_id]
    );

    let users: unknown[] = [];
    if (row.company_id) {
      const usersResult = await query(
        `SELECT id, name, email, role, is_active, created_at, last_login_at
         FROM users
         WHERE company_id = $1 AND is_deleted = false
         ORDER BY created_at ASC`,
        [row.company_id]
      );
      users = usersResult.rows;
    }

    const notesHistory =
      row.notes && String(row.notes).trim()
        ? String(row.notes)
            .split('\n')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];

    res.json(
      success({
        license: {
          ...row,
          features: featuresResult.rows.map((f: any) => ({
            key: f.feature_key,
            label: f.feature_label,
            included: f.is_included,
          })),
        },
        users,
        notes_history: notesHistory,
        timeline: {
          requested_at: row.requested_at,
          activated_at: row.activated_at,
          expires_at: row.expires_at,
          revoked_at: row.status === 'revoked' ? row.updated_at : null,
        },
      })
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function extendLicense(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { days } = req.body as { days: number };

    const result = await withTransaction(async (client) => {
      const upd = await client.query(
        `UPDATE licenses
         SET expires_at = GREATEST(COALESCE(expires_at, NOW()), NOW()) + ($1::int * INTERVAL '1 day'),
             updated_at = NOW()
         WHERE id = $2 AND is_deleted = false AND status IN ('active', 'trial')
         RETURNING id, license_key, status, expires_at, company_id`,
        [days, id]
      );

      if (!upd.rows.length) return null;

      const license = upd.rows[0];
      if (license.company_id) {
        await client.query(
          `UPDATE companies
           SET plan_expires_at = $1,
               is_active = true,
               updated_at = NOW()
           WHERE id = $2 AND is_deleted = false`,
          [license.expires_at, license.company_id]
        );
      }

      return license;
    });

    if (!result) {
      return res.status(404).json(error('Active or trial license not found'));
    }

    if (result.company_id) {
      await clearTierFeaturesCache(result.company_id);
    }

    await logAction(req.user!.id, null, 'extend_license', 'license', id, null, { days }, req.ip, req.get('User-Agent'));

    res.json(success({ license: result }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getLicenseTiersSuper(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT id, name, display_name, max_users, price_inr, description, sort_order
       FROM license_tiers
       WHERE is_active = true
       ORDER BY sort_order ASC, price_inr ASC`
    );
    res.json(success({ tiers: result.rows }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function updateLicensePlanSuper(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { tier_id, status, expires_days, expires_at, notes } = req.body as {
      tier_id: string;
      status?: 'active' | 'trial';
      expires_days?: number;
      expires_at?: string;
      notes?: string;
    };

    const nextStatus = status === 'trial' ? 'trial' : 'active';
    const expiresAt = expires_at
      ? new Date(expires_at)
      : new Date(Date.now() + (Number(expires_days || 365) * 24 * 60 * 60 * 1000));
    if (Number.isNaN(expiresAt.getTime())) {
      return res.status(400).json(error('Invalid expiry date'));
    }

    const result = await withTransaction(async (client) => {
      const licRes = await client.query(
        `SELECT l.*, c.id AS company_id
         FROM licenses l
         LEFT JOIN companies c ON c.id = l.company_id AND c.is_deleted = false
         WHERE l.id = $1 AND l.is_deleted = false
         FOR UPDATE OF l`,
        [id],
      );
      if (!licRes.rows.length) throw new Error('License not found');
      const lic = licRes.rows[0];
      if (lic.status === 'revoked') throw new Error('Revoked licenses cannot be converted. Create a new request instead.');

      const tierRes = await client.query(
        `SELECT id, name, display_name, max_users, price_inr FROM license_tiers WHERE id = $1 AND is_active = true`,
        [tier_id],
      );
      if (!tierRes.rows.length) throw new Error('Plan not found');
      const tier = tierRes.rows[0];

      const stamp = notes && String(notes).trim()
        ? `\n[${new Date().toISOString()}] Superadmin changed plan to ${tier.display_name} (${nextStatus}): ${String(notes).trim()}`
        : `\n[${new Date().toISOString()}] Superadmin changed plan to ${tier.display_name} (${nextStatus})`;

      const upd = await client.query(
        `UPDATE licenses
         SET tier_id = $1,
             status = $2,
             activated_at = COALESCE(activated_at, NOW()),
             expires_at = $3,
             notes = CASE
               WHEN notes IS NULL OR trim(notes) = '' THEN trim($4::text)
               ELSE trim(notes) || $4::text
             END,
             updated_at = NOW()
         WHERE id = $5
         RETURNING id, license_key, status, tier_id, company_id, expires_at`,
        [tier.id, nextStatus, expiresAt, stamp, id],
      );

      if (lic.company_id) {
        await client.query(
          `UPDATE companies
           SET license_id = $1,
               plan_type = $2,
               plan_expires_at = $3,
               is_active = true,
               updated_at = NOW()
           WHERE id = $4`,
          [id, nextStatus === 'trial' ? 'trial' : tier.name, expiresAt, lic.company_id],
        );
      }

      return { license: upd.rows[0], tier };
    });

    if (result.license.company_id) {
      await clearTierFeaturesCache(result.license.company_id);
    }

    await logAction(req.user!.id, null, 'update_license_plan', 'license', id, null, result, req.ip, req.get('User-Agent'));
    res.json(success(result));
  } catch (err: any) {
    const msg = err.message || 'Failed to update license plan';
    res.status(/not found|cannot|invalid|plan/i.test(msg) ? 400 : 500).json(error(msg));
  }
}

export async function getAllCompanies(req: Request, res: Response) {
  try {
    const { q } = req.query as { q?: string };
    const { page, limit, offset } = parsePagination(req.query);

    const conditions: string[] = ['c.is_deleted = false'];
    const params: unknown[] = [];

    if (q && String(q).trim()) {
      params.push(`%${String(q).trim().toLowerCase()}%`);
      const p = params.length;
      conditions.push(`(
        lower(c.name) LIKE $${p} OR lower(coalesce(c.email, '')) LIKE $${p}
        OR lower(coalesce(c.gstin, '')) LIKE $${p}
      )`);
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`;

    const countRes = await query(`SELECT COUNT(*)::int AS c FROM companies c ${whereSql}`, params);
    const total = countRes.rows[0].c;

    params.push(limit, offset);
    const limIdx = params.length - 1;
    const offIdx = params.length;

    const result = await query(
      `SELECT c.id, c.name, c.email, c.gstin, c.is_active, c.created_at, c.plan_type,
              lic.id AS license_id, lic.license_key, lic.status AS license_status,
              lic.activated_at, lic.expires_at,
              lt.display_name AS tier_display_name, lt.name AS tier_name,
              (SELECT COUNT(*)::int FROM users u
               WHERE u.company_id = c.id AND u.is_deleted = false AND u.is_active = true) AS user_count
       FROM companies c
       LEFT JOIN licenses lic ON lic.id = c.license_id AND lic.is_deleted = false
       LEFT JOIN license_tiers lt ON lt.id = lic.tier_id
       ${whereSql}
       ORDER BY c.created_at DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      params
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getCompanyDetailSuper(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const compRes = await query(
      `SELECT c.*,
              lic.id AS license_id, lic.license_key, lic.status AS license_status,
              lic.requested_at AS license_requested_at, lic.activated_at AS license_activated_at,
              lic.expires_at AS license_expires_at, lic.notes AS license_notes,
              r.name AS registrant_name, r.email AS registrant_email, r.phone AS registrant_phone,
              lt.name AS tier_name, lt.display_name AS tier_display_name, lt.max_users AS tier_max_users
       FROM companies c
       LEFT JOIN licenses lic ON lic.id = c.license_id AND lic.is_deleted = false
       LEFT JOIN registrants r ON r.id = lic.registrant_id
       LEFT JOIN license_tiers lt ON lt.id = lic.tier_id
       WHERE c.id = $1 AND c.is_deleted = false`,
      [id]
    );

    if (!compRes.rows.length) {
      return res.status(404).json(error('Company not found'));
    }

    const usersRes = await query(
      `SELECT id, name, email, role, is_active, created_at, last_login_at
       FROM users
       WHERE company_id = $1 AND is_deleted = false
       ORDER BY created_at ASC`,
      [id]
    );

    res.json(
      success({
        company: compRes.rows[0],
        users: usersRes.rows,
      })
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function addUserToCompany(req: Request, res: Response) {
  try {
    const companyId = req.params.id;
    const { name, email, password, role } = req.body;

    const compCheck = await query('SELECT id FROM companies WHERE id = $1 AND is_deleted = false', [companyId]);
    if (!compCheck.rows.length) {
      return res.status(404).json(error('Company not found'));
    }

    const dup = await query(
      'SELECT id FROM users WHERE email = $1 AND company_id = $2 AND is_deleted = false',
      [email.toLowerCase(), companyId]
    );
    if (dup.rows.length) {
      return res.status(400).json(error('A user with this email already exists in this company'));
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (company_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, role, is_active, created_at`,
      [companyId, name, email.toLowerCase(), hash, role]
    );

    const newUser = result.rows[0];

    const nonAdminRoles = ['staff', 'cashier', 'manager', 'accountant', 'warehouse', 'sales', 'purchase'];
    if (nonAdminRoles.includes(newUser.role)) {
      const countRes = await query('SELECT COUNT(*) FROM employee_profiles WHERE company_id = $1', [companyId]);
      const empNum = parseInt(countRes.rows[0].count, 10) + 1;
      const empCode = `EMP-${String(empNum).padStart(4, '0')}`;
      await query(
        `INSERT INTO employee_profiles (company_id, user_id, employee_code, joining_date)
         VALUES ($1, $2, $3, CURRENT_DATE)
         ON CONFLICT (user_id) DO NOTHING`,
        [companyId, newUser.id, empCode]
      );
    }

    await logAction(
      req.user!.id,
      companyId,
      'create',
      'user',
      newUser.id,
      null,
      { name, email, role, via: 'super_admin' },
      req.ip,
      req.get('User-Agent')
    );

    res.status(201).json(success(newUser));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function toggleUserActive(req: Request, res: Response) {
  try {
    const { userId } = req.params;

    const cur = await query(
      `SELECT id, company_id, role, is_active FROM users WHERE id = $1 AND is_deleted = false`,
      [userId]
    );
    if (!cur.rows.length) {
      return res.status(404).json(error('User not found'));
    }

    const u = cur.rows[0];
    if (u.role === 'super_admin') {
      return res.status(400).json(error('Cannot toggle platform super admin'));
    }

    const next = !u.is_active;
    if (!next && ['company_admin', 'admin'].includes(u.role)) {
      const otherAdmins = await query(
        `SELECT COUNT(*)::int AS count
         FROM users
         WHERE company_id = $1
           AND id <> $2
           AND role IN ('company_admin', 'admin')
           AND is_active = true
           AND is_deleted = false`,
        [u.company_id, userId]
      );
      if (Number(otherAdmins.rows[0]?.count || 0) === 0) {
        return res.status(409).json(error('Add or activate another company administrator before disabling this user'));
      }
    }
    const upd = await query(
      `UPDATE users
       SET is_active = $1,
           session_version = CASE WHEN $1 = false THEN session_version + 1 ELSE session_version END,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, email, role, is_active`,
      [next, userId]
    );

    await logAction(
      req.user!.id,
      u.company_id,
      'toggle_user_active',
      'user',
      userId,
      { is_active: u.is_active },
      { is_active: next },
      req.ip,
      req.get('User-Agent')
    );

    res.json(success({ user: upd.rows[0] }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function deleteCompanyUser(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const current = await query(
      `SELECT id, company_id, name, email, role, is_active
       FROM users
       WHERE id = $1 AND is_deleted = false`,
      [userId]
    );
    if (!current.rows.length) {
      return res.status(404).json(error('User not found'));
    }

    const user = current.rows[0];
    if (user.role === 'super_admin' || !user.company_id) {
      return res.status(400).json(error('Platform administrators cannot be deleted here'));
    }

    if (['company_admin', 'admin'].includes(user.role)) {
      const otherAdmins = await query(
        `SELECT COUNT(*)::int AS count
         FROM users
         WHERE company_id = $1
           AND id <> $2
           AND role IN ('company_admin', 'admin')
           AND is_active = true
           AND is_deleted = false`,
        [user.company_id, userId]
      );
      if (Number(otherAdmins.rows[0]?.count || 0) === 0) {
        return res.status(409).json(error('Add or activate another company administrator before deleting this user'));
      }
    }

    const deleted = await query(
      `UPDATE users
       SET is_deleted = true,
           is_active = false,
           session_version = session_version + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, email, role`,
      [userId]
    );

    await logAction(
      req.user!.id,
      user.company_id,
      'delete_company_user',
      'user',
      userId,
      user,
      { is_deleted: true, is_active: false },
      req.ip,
      req.get('User-Agent')
    );

    res.json(success({ message: 'User deleted', user: deleted.rows[0] }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
