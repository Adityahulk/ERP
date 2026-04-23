import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/employeeController';

const router = Router();
router.use(verifyToken);

router.get('/', requireMinRole('manager'), ctrl.getEmployees);
router.post('/', requireMinRole('admin'), ctrl.createEmployee);
router.post('/:userId/resign', requireMinRole('admin'), ctrl.resignEmployee);

export default router;
