import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/leaveController';
import { requireMinRole } from '../middleware/role';

const router = Router();
router.use(verifyToken);

router.get('/balance/:userId', ctrl.getBalance);
router.post('/apply', ctrl.applyLeave);
router.patch('/:id/approve', requireMinRole('manager'), ctrl.approveLeave);

export default router;
