import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/leaveController';
import { requireMinRole } from '../middleware/role';

const router = Router();
router.use(verifyToken);

router.get('/types', ctrl.listLeaveTypes);
router.get('/balance/:userId', ctrl.getBalance);
router.get('/applications', ctrl.listApplications);
router.post('/apply', ctrl.applyLeave);
router.patch('/:id/approve', requireMinRole('manager'), ctrl.approveLeave);
router.patch('/:id/review', requireMinRole('manager'), ctrl.reviewLeave);

export default router;
