import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLog';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { normalizeRole } from '../lib/roles';

// ── GET /api/users ────────────────────────────────────────────
export async function listUsers(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { search, role, is_active } = req.query;

    let where = 'u.company_id = $1 AND u.is_deleted = false';
    const params: any[] = [companyId];
    let idx = 2;

    if (search) { where += ` AND (u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.phone ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (role) { where += ` AND u.role = $${idx}`; params.push(role); idx++; }
    if (is_active !== undefined) { where += ` AND u.is_active = $${idx}`; params.push(is_active === 'true'); idx++; }

    const countRes = await query(`SELECT COUNT(*) FROM users u WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.avatar_url, u.is_active, u.last_login_at, u.created_at,
              ep.designation, ep.department, g.name as godown_name
       FROM users u
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_deleted = false
       LEFT JOIN godowns g ON g.id = ep.godown_id AND g.is_deleted = false
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit)));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/users ───────────────────────────────────────────
export async function createUser(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { name, email, phone, password } = req.body;
    const role = normalizeRole(req.body.role);

    // Check duplicate email within company
    if (email) {
      const dup = await query(
        'SELECT id FROM users WHERE email = $1 AND company_id = $2 AND is_deleted = false', [email.toLowerCase(), companyId]
      );
      if (dup.rows.length) return res.status(400).json(error('A user with this email already exists'));
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (company_id, name, email, phone, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, phone, role, is_active, created_at`,
      [companyId, name, email?.toLowerCase(), phone, hash, role]
    );

    const newUser = result.rows[0];

    // Auto-create an employee profile for every non-admin user so HR attendance
    // and leave tracking work immediately — no manual HR setup required.
    const nonAdminRoles = ['staff', 'manager'];
    if (nonAdminRoles.includes(newUser.role)) {
      const countRes = await query(
        'SELECT COUNT(*) FROM employee_profiles WHERE company_id = $1', [companyId]
      );
      const empNum = parseInt(countRes.rows[0].count) + 1;
      const empCode = `EMP-${String(empNum).padStart(4, '0')}`;
      await query(
        `INSERT INTO employee_profiles (company_id, user_id, employee_code, joining_date)
         VALUES ($1, $2, $3, CURRENT_DATE)
         ON CONFLICT (user_id) DO NOTHING`,
        [companyId, newUser.id, empCode]
      );
    }

    await logAction(req.user!.id, companyId, 'create', 'user', newUser.id, null, { name, email, role }, req.ip);
    res.status(201).json(success(newUser));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/users/:id ──────────────────────────────────────
export async function updateUser(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const existing = await query(
      'SELECT id, name, email, phone, role, is_active FROM users WHERE id = $1 AND company_id = $2 AND is_deleted = false',
      [id, companyId]
    );
    if (!existing.rows.length) return res.status(404).json(error('User not found'));

    const fields = ['name','email','phone','is_active','avatar_url'];
    const updates: string[] = []; const values: any[] = []; let idx = 1;
    for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); } }
    if (req.body.role !== undefined) {
      updates.push(`role = $${idx++}`);
      values.push(normalizeRole(req.body.role));
    }

    if (req.body.password) {
      updates.push(`password_hash = $${idx++}`);
      values.push(await bcrypt.hash(req.body.password, 12));
    }

    if (!updates.length) return res.status(400).json(error('No fields to update'));

    values.push(id, companyId);
    const result = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING id, name, email, phone, role, is_active`,
      values
    );

    await logAction(req.user!.id, companyId, 'update', 'user', id, existing.rows[0], result.rows[0], req.ip);
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/users/sync-employee-profiles ────────────────────
// Backfill: auto-create employee_profile rows for every active non-admin user
// that doesn't already have one. Safe to call multiple times (ON CONFLICT DO NOTHING).
export async function syncEmployeeProfiles(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const nonAdminRoles = ['staff', 'manager'];

    const usersRes = await query(
      `SELECT u.id, u.role
       FROM users u
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_deleted = false
       WHERE u.company_id = $1
         AND u.is_deleted = false
         AND u.is_active = true
         AND u.role = ANY($2::text[])
         AND ep.id IS NULL`,
      [companyId, nonAdminRoles]
    );

    let created = 0;
    for (const u of usersRes.rows) {
      const countRes = await query(
        'SELECT COUNT(*) FROM employee_profiles WHERE company_id = $1', [companyId]
      );
      const empNum = parseInt(countRes.rows[0].count) + 1;
      const empCode = `EMP-${String(empNum).padStart(4, '0')}`;
      await query(
        `INSERT INTO employee_profiles (company_id, user_id, employee_code, joining_date)
         VALUES ($1, $2, $3, CURRENT_DATE)
         ON CONFLICT (user_id) DO NOTHING`,
        [companyId, u.id, empCode]
      );
      created++;
    }

    res.json(success({ synced: created, message: `${created} employee profile(s) created` }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── DELETE /api/users/:id ─────────────────────────────────────
export async function deleteUser(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (id === req.user!.id) return res.status(400).json(error('Cannot delete your own account'));

    const result = await query(
      'UPDATE users SET is_deleted = true, is_active = false WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, req.user!.company_id]
    );
    if (!result.rows.length) return res.status(404).json(error('User not found'));

    await logAction(req.user!.id, req.user!.company_id, 'delete', 'user', id, null, null, req.ip);
    res.json(success({ message: 'User deleted' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
