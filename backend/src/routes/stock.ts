import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { validateBody } from '../middleware/validate';
import * as ctrl from '../controllers/stockController';

const router = Router();
router.use(verifyToken);

const transferSchema = z.object({
  from_godown_id: z.string().uuid(),
  to_godown_id: z.string().uuid(),
  transfer_date: z.string(),
  notes: z.string().optional(),
  items: z.array(z.object({
    item_id: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1, 'At least one item is required'),
});

const receiveSchema = z.object({
  items: z.array(z.object({
    item_id: z.string().uuid(),
    quantity_received: z.number().int().min(0),
  })).min(1),
});

const adjustmentSchema = z.object({
  godown_id: z.string().uuid(),
  adjustment_date: z.string(),
  reason: z.string().min(1, 'Reason is required'),
  notes: z.string().optional(),
  items: z.array(z.object({
    item_id: z.string().uuid(),
    current_quantity: z.number().int().min(0),
    adjusted_quantity: z.number().int().min(0),
    reason: z.string().optional(),
  })).min(1),
});

router.get('/', ctrl.listStock);
router.get('/valuation', requireMinRole('accountant'), ctrl.stockValuation);
router.get('/low-stock', ctrl.lowStock);
router.get('/movements', ctrl.listMovements);
router.get('/item/:itemId', ctrl.getItemStock);

router.post('/transfer', requireMinRole('manager'), validateBody(transferSchema), ctrl.createTransfer);
router.post('/transfer/:id/receive', requireMinRole('manager'), validateBody(receiveSchema), ctrl.receiveTransfer);
router.post('/adjustment', requireMinRole('manager'), validateBody(adjustmentSchema), ctrl.createAdjustment);

export default router;
