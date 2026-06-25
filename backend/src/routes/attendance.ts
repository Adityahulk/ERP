import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/attendanceController';
import { requireMinRole } from '../middleware/role';

const router = Router();
router.use(verifyToken);

router.post('/clock-in', ctrl.clockIn);
router.post('/clock-out', ctrl.clockOut);
router.get('/today', ctrl.getToday);
router.get('/company/today', requireMinRole('manager'), ctrl.getCompanyToday);
router.get('/godown/:godownId/today', requireMinRole('manager'), ctrl.getGodownToday);
router.post('/regularize', requireMinRole('manager'), ctrl.regularize);

export default router;
