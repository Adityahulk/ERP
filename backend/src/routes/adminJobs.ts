import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import * as ctrl from '../controllers/jobMonitorController';

const router = Router();
router.use(verifyToken, requireRole('super_admin'));

router.get('/overview', ctrl.getJobsOverview);
router.get('/runs', ctrl.getJobRuns);
router.get('/:queue/dead-letter', ctrl.getDeadLetterJobs);
router.post('/:queue/dead-letter/:id/retry', ctrl.retryDeadLetterJob);

export default router;
