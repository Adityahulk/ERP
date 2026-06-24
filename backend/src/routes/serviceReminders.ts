import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/serviceReminderController';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.listServiceReminders);
router.post('/', requireMinRole('manager'), ctrl.createServiceReminder);
router.patch('/:id', requireMinRole('manager'), ctrl.updateServiceReminder);
router.delete('/:id', requireMinRole('manager'), ctrl.deleteServiceReminder);

export default router;
