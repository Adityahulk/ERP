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

// POST /api/barcode/scan — unified Sale/Purchase/Transfer/Audit mode scan
router.post('/scan', ctrl.scanWithMode);

// GET /api/barcode/scan/history — barcode-driven stock audit trail
router.get('/scan/history', ctrl.getScanHistory);

// GET /api/barcode/registry — every barcoded item, current stock, last scan
router.get('/registry', ctrl.getBarcodeRegistry);
router.get('/registry/stats', ctrl.getBarcodeRegistryStats);
router.get('/scan-analytics', ctrl.getScanAnalytics);
router.get('/registry/:itemId/history', ctrl.getItemBarcodeHistory);

export default router;
