import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { isAdminRole } from '../lib/roles';

function canPunch(role: string): boolean {
  return !isAdminRole(role);
}

export async function clockIn(req: Request, res: Response) {
  try {
     const userId = req.user!.id;
     const companyId = req.user!.company_id;
     if (!canPunch(req.user!.role)) {
       return res.status(403).json(error('Admins do not need to punch in/out'));
     }
 
     const check = await query(
       'SELECT id FROM attendance WHERE user_id = $1 AND company_id = $2 AND date = CURRENT_DATE',
       [userId, companyId]
     );
     if (check.rows.length) return res.status(400).json(error('Already clocked in today'));

     const result = await query(
       `INSERT INTO attendance (user_id, company_id, godown_id, date, status, clock_in) 
        VALUES ($1, $2, $3, CURRENT_DATE, 'present', NOW()) RETURNING *`,
       [userId, companyId, req.user!.godown_id || null]
     );
     res.json(success(result.rows[0]));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function clockOut(req: Request, res: Response) {
  try {
     const userId = req.user!.id;
     if (!canPunch(req.user!.role)) {
       return res.status(403).json(error('Admins do not need to punch in/out'));
     }
     const result = await query(
       `UPDATE attendance
        SET clock_out = NOW()
        WHERE user_id = $1 AND company_id = $2 AND date = CURRENT_DATE AND clock_in IS NOT NULL AND clock_out IS NULL
        RETURNING *`,
       [userId, req.user!.company_id]
     );
     if (!result.rows.length) return res.status(400).json(error('No active clock-in found for today'));
     res.json(success(result.rows[0]));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function getToday(req: Request, res: Response) {
  try {
      const result = await query(
        'SELECT * FROM attendance WHERE user_id = $1 AND company_id = $2 AND date = CURRENT_DATE',
        [req.user!.id, req.user!.company_id]
      );
      res.json(success(result.rows[0] || null));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function getGodownToday(req: Request, res: Response) {
  try {
      const { godownId } = req.params;
      const result = await query(
         `SELECT a.*, u.name as user_name 
          FROM attendance a JOIN users u ON a.user_id = u.id
          WHERE a.company_id = $1 AND a.date = CURRENT_DATE AND u.godown_id = $2`,
         [req.user!.company_id, godownId]
      );
      res.json(success(result.rows));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function getCompanyToday(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT a.*, u.name as user_name, u.role as user_role, g.name as godown_name
       FROM users u
       LEFT JOIN attendance a
         ON a.user_id = u.id
        AND a.company_id = u.company_id
        AND a.date = CURRENT_DATE
       LEFT JOIN godowns g ON g.id = COALESCE(a.godown_id, u.godown_id)
       WHERE u.company_id = $1
         AND u.is_deleted = false
         AND u.is_active = true
         AND u.role NOT IN ('admin', 'super_admin')
       ORDER BY u.name ASC`,
      [req.user!.company_id]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function regularize(req: Request, res: Response) {
   try {
     const { user_id, date, clock_in, clock_out, note } = req.body;
     const result = await query(
       `INSERT INTO attendance (user_id, company_id, date, clock_in, clock_out, status, is_regularized, regularization_note)
        VALUES ($1, $2, $3, $4, $5, 'present', true, $6)
        ON CONFLICT (user_id, date) DO UPDATE 
        SET clock_in = EXCLUDED.clock_in, clock_out = EXCLUDED.clock_out, status = 'present', is_regularized = true, regularization_note = EXCLUDED.regularization_note
        RETURNING *`,
       [user_id, req.user!.company_id, date, clock_in, clock_out, note]
     );
     res.json(success(result.rows[0]));
   } catch(err:any){ res.status(500).json(error(err.message)); }
}
