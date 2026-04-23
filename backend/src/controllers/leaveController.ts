import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';

export async function getBalance(req: Request, res: Response) {
  try {
     const { userId } = req.params;
     const { year } = req.query;
     const targetYear = year || new Date().getFullYear();
     
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
     const ms = new Date(to_date).getTime() - new Date(from_date).getTime();
     const total_days = half_day ? 0.5 : (ms / (1000 * 3600 * 24)) + 1; // Simplified: ignores sundays for now

     const result = await query(
        `INSERT INTO leave_applications (user_id, company_id, leave_type_id, from_date, to_date, total_days, reason, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING *`,
        [req.user!.id, req.user!.company_id, leave_type_id, from_date, to_date, total_days, reason]
     );
     res.json(success(result.rows[0]));
   } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function approveLeave(req: Request, res: Response) {
   try {
      const { id } = req.params;
      const result = await query(`UPDATE leave_applications SET status = 'approved', approved_by = $1 WHERE id = $2 RETURNING *`, [req.user!.id, id]);
      res.json(success(result.rows[0]));
   } catch(err:any){ res.status(500).json(error(err.message)); }
}
