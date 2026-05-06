import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { normalizeRole } from '../lib/roles';

function canManageLeaves(role: string): boolean {
  return ['manager', 'admin', 'super_admin'].includes(normalizeRole(role));
}

async function seedDefaultLeaveTypes(companyId: string) {
  const count = await query('SELECT COUNT(*)::int AS n FROM leave_types WHERE company_id = $1', [companyId]);
  if ((count.rows[0]?.n || 0) > 0) return;
  const rows = [
    ['Casual Leave', 'CL', 12, true, false, 0],
    ['Sick Leave', 'SL', 6, true, false, 0],
    ['Earned Leave', 'EL', 15, true, true, 30],
    ['Leave Without Pay', 'LWP', 0, false, false, 0],
    ['Maternity Leave', 'ML', 182, true, false, 0],
    ['Paternity Leave', 'PL', 7, true, false, 0],
  ];
  for (const [name, code, days, paid, carry, maxCarry] of rows) {
    await query(
      `INSERT INTO leave_types (company_id, name, code, days_per_year, is_paid, carry_forward, max_carry_forward, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT DO NOTHING`,
      [companyId, name, code, days, paid, carry, maxCarry],
    );
  }
}

export async function listLeaveTypes(req: Request, res: Response) {
  try {
    await seedDefaultLeaveTypes(req.user!.company_id);
    const result = await query(
      `SELECT id, name, code, days_per_year, is_paid
       FROM leave_types
       WHERE company_id = $1 AND is_active = true
       ORDER BY name ASC`,
      [req.user!.company_id]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getBalance(req: Request, res: Response) {
  try {
     const { userId } = req.params;
     if (req.user!.id !== userId && !canManageLeaves(req.user!.role)) {
       return res.status(403).json(error('Insufficient permissions'));
     }
     const { year } = req.query;
     const targetYear = year || new Date().getFullYear();
     await seedDefaultLeaveTypes(req.user!.company_id);
     
     // Get leave types
     const typesDesc = await query('SELECT * FROM leave_types WHERE company_id = $1', [req.user!.company_id]);
     const balances = typesDesc.rows.map(lt => ({ id: lt.id, name: lt.name, allocated: lt.days_per_year, used: 0, pending: 0, available: lt.days_per_year }));
     
     const apps = await query(
       `SELECT leave_type_id, status, SUM(total_days) as total 
        FROM leave_applications WHERE user_id = $1 AND EXTRACT(YEAR FROM from_date)= $2 AND status IN ('approved', 'pending')
        GROUP BY leave_type_id, status`, 
       [userId, targetYear]
     );

     apps.rows.forEach(r => {
        const target = balances.find(b => b.id === r.leave_type_id);
        if(target) {
            if(r.status === 'approved') target.used += Number(r.total);
            if(r.status === 'pending') target.pending += Number(r.total);
            target.available = target.allocated - target.used - target.pending;
        }
     });

     res.json(success(balances));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function applyLeave(req: Request, res: Response) {
   try {
     const { leave_type_id, from_date, to_date, reason, half_day } = req.body;
     if (!leave_type_id || !from_date || !to_date || !reason) {
       return res.status(400).json(error('leave_type_id, from_date, to_date and reason are required'));
     }
     if (new Date(from_date).getTime() > new Date(to_date).getTime()) {
       return res.status(400).json(error('from_date cannot be after to_date'));
     }
     const ms = new Date(to_date).getTime() - new Date(from_date).getTime();
     const total_days = half_day ? 0.5 : (ms / (1000 * 3600 * 24)) + 1; // Simplified: ignores sundays for now

     const result = await query(
        `INSERT INTO leave_applications (user_id, company_id, godown_id, leave_type_id, from_date, to_date, total_days, half_day, reason, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending') RETURNING *`,
        [req.user!.id, req.user!.company_id, req.user!.godown_id || null, leave_type_id, from_date, to_date, total_days, !!half_day, reason]
     );
     res.json(success(result.rows[0]));
   } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function listApplications(req: Request, res: Response) {
  try {
    const { status, mine } = req.query;
    let where = `la.company_id = $1 AND la.is_deleted = false`;
    const params: any[] = [req.user!.company_id];
    let idx = 2;

    if (status) {
      where += ` AND la.status = $${idx++}`;
      params.push(status);
    }
    if (mine === 'true') {
      where += ` AND la.user_id = $${idx++}`;
      params.push(req.user!.id);
    }

    const result = await query(
      `SELECT la.*, u.name AS user_name, lt.name AS leave_type_name, rv.name AS reviewed_by_name
       FROM leave_applications la
       JOIN users u ON u.id = la.user_id
       LEFT JOIN leave_types lt ON lt.id = la.leave_type_id
       LEFT JOIN users rv ON rv.id = la.reviewed_by
       WHERE ${where}
       ORDER BY la.created_at DESC
       LIMIT 200`,
      params
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function reviewLeave(req: Request, res: Response) {
   try {
      const { id } = req.params;
      const status = String(req.body.status || '').toLowerCase();
      const note = req.body.note ? String(req.body.note) : null;
      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json(error('status must be approved or rejected'));
      }
      const result = await query(
        `UPDATE leave_applications
         SET status = $1, reviewed_by = $2, review_note = $3, reviewed_at = NOW()
         WHERE id = $4 AND company_id = $5 AND is_deleted = false
         RETURNING *`,
        [status, req.user!.id, note, id, req.user!.company_id]
      );
      if (!result.rows.length) return res.status(404).json(error('Leave application not found'));
      res.json(success(result.rows[0]));
   } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function approveLeave(req: Request, res: Response) {
  req.body.status = 'approved';
  return reviewLeave(req, res);
}
