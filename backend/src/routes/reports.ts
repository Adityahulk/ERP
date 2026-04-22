import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/reportController';

const router = Router();
router.use(verifyToken);

router.get('/dashboard', ctrl.getDashboard);
router.get('/profit-loss', requireMinRole('accountant'), ctrl.profitLoss);
router.get('/gst', requireMinRole('accountant'), ctrl.gstReport);
router.get('/party-statement', ctrl.partyStatement);

export default router;
