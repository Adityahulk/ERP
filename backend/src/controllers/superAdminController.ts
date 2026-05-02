import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';

export async function getDashboardStats(req: Request, res: Response) {
  try {
    const statsRes = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM licenses WHERE is_deleted = false) AS total_licenses,
         (SELECT COUNT(*)::int FROM licenses WHERE status = 'pending' AND is_deleted = false) AS pending_licenses,
         (SELECT COUNT(*)::int FROM licenses WHERE status = 'active' AND is_deleted = false) AS active_licenses,
         (SELECT COUNT(*)::int FROM licenses WHERE status = 'revoked' AND is_deleted = false) AS revoked_licenses,
         (SELECT COUNT(*)::int FROM companies WHERE is_deleted = false) AS total_companies,
         (SELECT COUNT(*)::int FROM users WHERE is_deleted = false AND company_id IS NOT NULL) AS total_users,
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

    res.json(
      success({
        ...stats,
        revenue_potential: Number(stats.revenue_potential),
        recent_requests: recentReq.rows,
        recent_activity: recentActivity.rows,
      })
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getAllLicenses(req: Request, res: Response) {
  try {
    const { status, q } = req.query as { status?: string; q?: string };
    const { page, limit, offset } = parsePagination(req.query);

    const conditions: string[] = ['l.is_deleted = false'];
    const params: unknown[] = [];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`l.status = $${params.length}`);
    }

    if (q && String(q).trim()) {
      params.push(`%${String(q).trim().toLowerCase()}%`);
      const p = params.length;
      conditions.push(`(
        lower(r.name) LIKE $${p} OR lower(r.email) LIKE $${p}
        OR lower(coalesce(c.name, '')) LIKE $${p}
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
      `SELECT l.id, l.license_key, l.status, l.requested_at, l.activated_at, l.expires_at, l.notes,
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

    const result = await query(
      `UPDATE licenses
       SET expires_at = COALESCE(expires_at, NOW()) + ($1::int * INTERVAL '1 day'),
           updated_at = NOW()
       WHERE id = $2 AND is_deleted = false AND status = 'active'
       RETURNING id, license_key, status, expires_at`,
      [days, id]
    );

    if (!result.rows.length) {
      return res.status(404).json(error('Active license not found'));
    }

    await logAction(req.user!.id, null, 'extend_license', 'license', id, null, { days }, req.ip, req.get('User-Agent'));

    res.json(success({ license: result.rows[0] }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
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
    const upd = await query(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, role, is_active`,
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
