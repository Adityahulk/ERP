import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/printController';

const router = Router();
router.use(verifyToken);

router.get('/receipt/:invoiceId', ctrl.getReceiptPdf);

export default router;
