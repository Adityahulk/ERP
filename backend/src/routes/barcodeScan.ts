import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import * as ctrl from '../controllers/barcodeScanController';

const router = Router();
router.use(verifyToken);

const scanOutSchema = z.object({
  barcode: z.string().min(1, 'Barcode is required'),
  godown_id: z.string().uuid('A valid godown is required'),
  quantity: z.coerce.number().positive().default(1),
  notes: z.string().optional(),
});

// POST /api/barcode/scan-out — scan → find item → reduce stock → log movement
router.post('/scan-out', validateBody(scanOutSchema), ctrl.scanAndDeduct);

// GET /api/barcode/scan/history — barcode-driven stock audit trail
router.get('/scan/history', ctrl.getScanHistory);

export default router;
