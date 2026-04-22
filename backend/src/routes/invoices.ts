import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { validateBody } from '../middleware/validate';
import * as ctrl from '../controllers/invoiceController';

const router = Router();
router.use(verifyToken);

const lineItemSchema = z.object({
  item_id: z.string().uuid().optional(),
  description: z.string().optional(),
  hsn_code: z.string().optional(),
  quantity: z.number().positive('Quantity must be positive'),
  unit_price: z.number().int().min(0, 'Unit price must be positive'),
  discount_percent: z.number().min(0).max(100).optional(),
  discount_amount: z.number().int().min(0).optional(),
  gst_rate: z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]).default(18),
  cess_rate: z.number().min(0).optional(),
});

const createSchema = z.object({
  invoice_type: z.enum(['sale', 'purchase', 'credit_note', 'debit_note']).default('sale'),
  invoice_number: z.string().optional(),
  party_id: z.string().uuid(),
  godown_id: z.string().uuid().optional(),
  invoice_date: z.string().optional(),
  due_date: z.string().optional(),
  is_interstate: z.boolean().default(false),
  items: z.array(lineItemSchema).min(1, 'At least one item is required'),
  discount_amount: z.number().int().min(0).optional(),
  round_off: z.number().int().optional(),
  amount_paid: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  terms_and_conditions: z.string().optional(),
});

router.get('/', ctrl.listInvoices);
router.post('/', validateBody(createSchema), ctrl.createInvoice);
router.get('/:id', ctrl.getInvoice);
router.patch('/:id/cancel', requireMinRole('manager'), ctrl.cancelInvoice);
router.delete('/:id', requireMinRole('company_admin'), ctrl.deleteInvoice);

export default router;
