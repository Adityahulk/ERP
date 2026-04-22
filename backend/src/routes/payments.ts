import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { validateBody } from '../middleware/validate';
import * as ctrl from '../controllers/paymentController';

const router = Router();
router.use(verifyToken);

const createSchema = z.object({
  payment_type: z.enum(['payment_in', 'payment_out']).default('payment_in'),
  party_id: z.string().uuid(),
  invoice_id: z.string().uuid().optional(),
  payment_date: z.string().optional(),
  amount: z.number().int().positive('Amount must be positive'),
  payment_mode: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other']).default('cash'),
  reference_number: z.string().optional(),
  bank_name: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/', ctrl.listPayments);
router.post('/', validateBody(createSchema), ctrl.createPayment);
router.get('/:id', ctrl.getPayment);
router.delete('/:id', requireMinRole('manager'), ctrl.deletePayment);

export default router;
