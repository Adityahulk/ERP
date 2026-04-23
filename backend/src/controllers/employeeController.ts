import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';

export async function createEmployee(req: Request, res: Response) {
  try {
     const { user_id, designation, department, godown_id, joining_date, employment_type, annual_salary, pan_number } = req.body;
     const companyId = req.user!.company_id;
     
     // Generate EMP code
     const countRes = await query('SELECT count(*) from employee_profiles WHERE company_id = $1', [companyId]);
     const count = parseInt(countRes.rows[0].count) + 1;
     const employeeCode = `EMP-G${godown_id || 1}-${String(count).padStart(4, '0')}`;

     const result = await query(
       `INSERT INTO employee_profiles (user_id, company_id, employee_code, designation, department, godown_id, joining_date, employment_type, annual_salary, pan_number)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
       [user_id, companyId, employeeCode, designation, department, godown_id, joining_date, employment_type, annual_salary, pan_number]
     );
     res.json(success(result.rows[0]));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function getEmployees(req: Request, res: Response) {
  try {
     const result = await query(
       `SELECT e.*, u.name, u.email, u.phone, u.is_active as user_active 
        FROM employee_profiles e JOIN users u ON e.user_id = u.id
        WHERE e.company_id = $1`, [req.user!.company_id]
     );
     res.json(success(result.rows));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}

export async function resignEmployee(req: Request, res: Response) {
  try {
     const { userId } = req.params;
     const { resignation_date, reason } = req.body;
     
     await withTransaction(async (client) => {
        await client.query(`UPDATE employee_profiles SET is_active = false, resignation_date = $1, resignation_reason = $2 WHERE user_id = $3`, [resignation_date, reason, userId]);
        await client.query(`UPDATE users SET is_active = false WHERE id = $1`, [userId]);
     });
     res.json(success({ message: "Employee marked as resigned." }));
  } catch(err:any){ res.status(500).json(error(err.message)); }
}
