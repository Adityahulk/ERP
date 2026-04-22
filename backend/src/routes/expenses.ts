import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { validateBody } from '../middleware/validate';
import * as ctrl from '../controllers/expenseController';

const router = Router();
router.use(verifyToken);

const createSchema = z.object({
  expense_date: z.string().optional(),
  category: z.string().min(1, 'Category is required'),
  amount: z.number().int().positive('Amount must be positive'),
  gst_rate: z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]).optional(),
  payment_mode: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other']).default('cash'),
  reference_number: z.string().optional(),
  vendor_name: z.string().optional(),
  vendor_gstin: z.string().max(15).optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  is_reimbursable: z.boolean().optional(),
});

router.get('/', ctrl.listExpenses);
router.post('/', validateBody(createSchema), ctrl.createExpense);
router.get('/:id', ctrl.getExpense);
router.patch('/:id', ctrl.updateExpense);
router.delete('/:id', requireMinRole('manager'), ctrl.deleteExpense);

export default router;
