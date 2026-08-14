import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { getUploadUrl } from '../services/fileUpload';
import { normalizeRole } from '../lib/roles';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function cleanUuid(value: unknown): string | null {
  if (value === undefined || value === null || value === '' || value === 'null' || value === 'undefined') return null;
  return isValidUuid(value) ? value : null;
}

function routeUserId(req: Request): string {
  const userId = req.params.userId || req.user!.id;
  if (!isValidUuid(userId)) throw new Error('Invalid employee id');
  return userId;
}

export async function createEmployee(req: Request, res: Response) {
  try {
     const { user_id, designation, department, godown_id, joining_date, employment_type, annual_salary, pan_number } = req.body;
     const companyId = req.user!.company_id;
     if (!isValidUuid(user_id)) return res.status(400).json(error('Invalid employee user id'));
     const cleanGodownId = cleanUuid(godown_id);
     
     // Generate EMP code
     const countRes = await query('SELECT count(*) from employee_profiles WHERE company_id = $1', [companyId]);
     const count = parseInt(countRes.rows[0].count) + 1;
     const employeeCode = `EMP-G${cleanGodownId ? cleanGodownId.slice(0, 4).toUpperCase() : 1}-${String(count).padStart(4, '0')}`;

     const result = await query(
       `INSERT INTO employee_profiles (user_id, company_id, employee_code, designation, department, godown_id, joining_date, employment_type, annual_salary, pan_number)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id) DO UPDATE SET
          designation = EXCLUDED.designation,
          department = EXCLUDED.department,
          godown_id = EXCLUDED.godown_id,
          joining_date = EXCLUDED.joining_date,
          employment_type = EXCLUDED.employment_type,
          annual_salary = EXCLUDED.annual_salary,
          pan_number = EXCLUDED.pan_number,
          is_deleted = false,
          is_active = true,
          updated_at = NOW()
        RETURNING *`,
       [user_id, companyId, employeeCode, designation, department, cleanGodownId, joining_date, employment_type, annual_salary, pan_number]
     );
     res.json(success(result.rows[0]));
  } catch(err:any){ res.status(err.message === 'Invalid employee id' ? 400 : 500).json(error(err.message)); }
}

export async function getEmployees(req: Request, res: Response) {
  try {
     const result = await query(
       `SELECT ep.*, ep.id AS employee_profile_id,
               u.id, u.id AS user_id, u.name, u.email, u.phone, u.role, u.is_active as user_active,
               g.name AS godown_name
        FROM users u
        LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_deleted = false
        LEFT JOIN godowns g ON g.id = ep.godown_id AND g.is_deleted = false
        WHERE u.company_id = $1
          AND u.is_deleted = false
          AND u.role NOT IN ('admin', 'company_admin', 'super_admin')
        ORDER BY u.name ASC`, [req.user!.company_id]
     );
     res.json(success(result.rows));
  } catch(err:any){ res.status(err.message === 'Invalid employee id' ? 400 : 500).json(error(err.message)); }
}

function monthStart(input?: string) {
  const d = input ? new Date(`${input.slice(0, 7)}-01T00:00:00.000Z`) : new Date();
  if (Number.isNaN(d.getTime())) throw new Error('Invalid month');
  return d.toISOString().slice(0, 10);
}

async function assertEmployeeAccess(req: Request, userId: string) {
  const role = normalizeRole(req.user!.role);
  const canManage = ['manager', 'admin', 'super_admin'].includes(role);
  if (!canManage && userId !== req.user!.id) throw new Error('Forbidden');
}

export async function getMyProfile(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const companyId = req.user!.company_id;
    const result = await query(
      `SELECT ep.*, ep.id AS employee_profile_id,
              u.id AS id, u.id AS user_id, u.name, u.email, u.phone, u.role, u.avatar_url, u.is_active,
              g.name AS godown_name
       FROM users u
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_deleted = false
       LEFT JOIN godowns g ON g.id = ep.godown_id AND g.is_deleted = false
       WHERE u.id = $1 AND u.company_id = $2 AND u.is_deleted = false`,
      [userId, companyId],
    );
    if (!result.rows.length) return res.status(404).json(error('Profile not found'));

    const docs = await query(
      `SELECT * FROM employee_documents WHERE company_id = $1 AND user_id = $2 AND is_deleted = false ORDER BY created_at DESC`,
      [companyId, userId],
    );
    res.json(success({ ...result.rows[0], documents: docs.rows }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getEmployeeProfile(req: Request, res: Response) {
  try {
    const userId = routeUserId(req);
    await assertEmployeeAccess(req, userId);
    const companyId = req.user!.company_id;
    const result = await query(
      `SELECT ep.*, ep.id AS employee_profile_id,
              u.id AS id, u.id AS user_id, u.name, u.email, u.phone, u.role, u.avatar_url, u.is_active,
              g.name AS godown_name
       FROM users u
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_deleted = false
       LEFT JOIN godowns g ON g.id = ep.godown_id AND g.is_deleted = false
       WHERE u.id = $1 AND u.company_id = $2 AND u.is_deleted = false`,
      [userId, companyId],
    );
    if (!result.rows.length) return res.status(404).json(error('Employee not found'));
    const docs = await query(
      `SELECT * FROM employee_documents WHERE company_id = $1 AND user_id = $2 AND is_deleted = false ORDER BY created_at DESC`,
      [companyId, userId],
    );
    const adjustments = await query(
      `SELECT * FROM employee_salary_adjustments WHERE company_id = $1 AND user_id = $2 AND is_deleted = false ORDER BY salary_month DESC, created_at DESC LIMIT 100`,
      [companyId, userId],
    );
    res.json(success({ ...result.rows[0], documents: docs.rows, salary_adjustments: adjustments.rows }));
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : err.message === 'Invalid employee id' ? 400 : 500;
    res.status(status).json(error(err.message));
  }
}

export async function updateEmployeeProfile(req: Request, res: Response) {
  try {
    const userId = routeUserId(req);
    await assertEmployeeAccess(req, userId);
    const companyId = req.user!.company_id;
    const d = req.body || {};
    const profileFields = [
      'designation', 'department', 'godown_id', 'joining_date', 'employment_type', 'annual_salary',
      'monthly_salary', 'basic_salary', 'hra', 'allowances', 'deductions', 'salary_type',
      'bank_name', 'bank_account_number', 'bank_ifsc', 'pan_number', 'aadhar_last4',
      'emergency_contact_name', 'emergency_contact_phone', 'date_of_birth', 'address',
    ];
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const field of profileFields) {
      if (d[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        values.push(field === 'godown_id' ? cleanUuid(d[field]) : d[field] === '' || d[field] === 'null' || d[field] === 'undefined' ? null : d[field]);
      }
    }
    if (!updates.length) return res.status(400).json(error('No fields to update'));
    await query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code, joining_date)
       SELECT $1, $2,
              'EMP-' || LPAD(((SELECT COUNT(*) + 1 FROM employee_profiles WHERE company_id = $1))::text, 4, '0'),
              CURRENT_DATE
       WHERE NOT EXISTS (
         SELECT 1 FROM employee_profiles WHERE company_id = $1 AND user_id = $2 AND is_deleted = false
       )
       ON CONFLICT (user_id) DO NOTHING`,
      [companyId, userId],
    );
    values.push(companyId, userId);
    const result = await query(
      `UPDATE employee_profiles SET ${updates.join(', ')}
       WHERE company_id = $${idx++} AND user_id = $${idx} AND is_deleted = false
       RETURNING *`,
      values,
    );
    if (!result.rows.length) return res.status(404).json(error('Employee profile not found'));
    res.json(success(result.rows[0]));
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : err.message === 'Invalid employee id' ? 400 : 500;
    res.status(status).json(error(err.message));
  }
}

export async function uploadEmployeeDocument(req: Request, res: Response) {
  try {
    const userId = routeUserId(req);
    await assertEmployeeAccess(req, userId);
    if (!req.file) return res.status(400).json(error('No document uploaded'));
    const url = getUploadUrl(req.file.path);
    const docType = String(req.body.document_type || 'general').slice(0, 100);
    const result = await query(
      `INSERT INTO employee_documents (company_id, user_id, document_type, document_name, file_url, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user!.company_id, userId, docType, req.file.originalname, url, req.user!.id],
    );
    res.json(success(result.rows[0]));
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : err.message === 'Invalid employee id' ? 400 : 500;
    res.status(status).json(error(err.message));
  }
}

export async function addSalaryAdjustment(req: Request, res: Response) {
  try {
    const userId = routeUserId(req);
    await assertEmployeeAccess(req, userId);
    if (!['admin', 'super_admin'].includes(normalizeRole(req.user!.role))) {
      return res.status(403).json(error('Only accounting or admin roles can add salary adjustments'));
    }
    const d = req.body || {};
    const result = await query(
      `INSERT INTO employee_salary_adjustments (
         company_id, user_id, salary_month, adjustment_type, title, amount, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.user!.company_id,
        userId,
        monthStart(d.salary_month),
        d.adjustment_type,
        d.title,
        Math.round(Number(d.amount) || 0),
        d.notes || null,
        req.user!.id,
      ],
    );
    res.json(success(result.rows[0]));
  } catch (err: any) {
    res.status(/Forbidden|Only/.test(err.message) ? 403 : err.message === 'Invalid employee id' ? 400 : 500).json(error(err.message));
  }
}

export async function generateSalarySlip(req: Request, res: Response) {
  try {
    const userId = routeUserId(req);
    await assertEmployeeAccess(req, userId);
    const companyId = req.user!.company_id;
    const salaryMonth = monthStart(String(req.body?.salary_month || req.query.month || ''));
    const monthEnd = new Date(`${salaryMonth}T00:00:00.000Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    const nextMonth = monthEnd.toISOString().slice(0, 10);

    const profileRes = await query(
      `SELECT u.name, u.email, ep.*
       FROM users u
       JOIN employee_profiles ep ON ep.user_id = u.id AND ep.company_id = u.company_id AND ep.is_deleted = false
       WHERE u.id = $1 AND u.company_id = $2 AND u.is_deleted = false`,
      [userId, companyId],
    );
    if (!profileRes.rows.length) return res.status(404).json(error('Employee profile not found'));
    const p = profileRes.rows[0];
    const gross = Number(p.monthly_salary || 0) || Math.round(Number(p.annual_salary || 0) / 12);

    const leaves = await query(
      `SELECT COALESCE(SUM(total_days), 0)::numeric AS unpaid
       FROM leave_applications la
       LEFT JOIN leave_types lt ON lt.id = la.leave_type_id
       WHERE la.company_id = $1 AND la.user_id = $2 AND la.status = 'approved'
         AND la.from_date >= $3 AND la.from_date < $4 AND COALESCE(lt.is_paid, true) = false`,
      [companyId, userId, salaryMonth, nextMonth],
    );
    const unpaidLeaveDays = Number(leaves.rows[0]?.unpaid || 0);
    const perDay = gross / 30;
    const leaveDeduction = Math.round(perDay * unpaidLeaveDays);

    const adj = await query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE adjustment_type = 'bonus'), 0)::int AS bonus,
         COALESCE(SUM(amount) FILTER (WHERE adjustment_type = 'deduction'), 0)::int AS deduction
       FROM employee_salary_adjustments
       WHERE company_id = $1 AND user_id = $2 AND salary_month = $3 AND is_deleted = false`,
      [companyId, userId, salaryMonth],
    );
    const bonus = Number(adj.rows[0]?.bonus || 0);
    const deduction = Number(adj.rows[0]?.deduction || 0) + Number(p.deductions || 0) + leaveDeduction;
    const net = Math.max(0, gross + bonus - deduction);

    const snapshot = {
      employee: { name: p.name, email: p.email, code: p.employee_code, designation: p.designation, department: p.department },
      salary: { gross, basic_salary: p.basic_salary || 0, hra: p.hra || 0, allowances: p.allowances || 0 },
      leaves: { unpaid_leave_days: unpaidLeaveDays, leave_deduction: leaveDeduction },
    };

    const slip = await query(
      `INSERT INTO employee_salary_slips (
         company_id, user_id, salary_month, gross_salary, unpaid_leave_days,
         bonus_amount, deduction_amount, net_salary, snapshot, generated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (company_id, user_id, salary_month) DO UPDATE SET
         gross_salary = EXCLUDED.gross_salary,
         unpaid_leave_days = EXCLUDED.unpaid_leave_days,
         bonus_amount = EXCLUDED.bonus_amount,
         deduction_amount = EXCLUDED.deduction_amount,
         net_salary = EXCLUDED.net_salary,
         snapshot = EXCLUDED.snapshot,
         generated_by = EXCLUDED.generated_by
       RETURNING *`,
      [companyId, userId, salaryMonth, gross, unpaidLeaveDays, bonus, deduction, net, snapshot, req.user!.id],
    );
    res.json(success(slip.rows[0]));
  } catch (err: any) {
    const status = err.message === 'Forbidden' ? 403 : err.message === 'Invalid employee id' ? 400 : 500;
    res.status(status).json(error(err.message));
  }
}

export async function resignEmployee(req: Request, res: Response) {
  try {
     const userId = routeUserId(req);
     const { resignation_date, reason } = req.body;
     
     await withTransaction(async (client) => {
        await client.query(`UPDATE employee_profiles SET is_active = false, resignation_date = $1, resignation_reason = $2 WHERE user_id = $3`, [resignation_date, reason, userId]);
        await client.query(`UPDATE users SET is_active = false WHERE id = $1`, [userId]);
     });
     res.json(success({ message: "Employee marked as resigned." }));
  } catch(err:any){ res.status(err.message === 'Invalid employee id' ? 400 : 500).json(error(err.message)); }
}
