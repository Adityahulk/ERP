import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { validateBody } from '../middleware/validate';
import * as ctrl from '../controllers/userController';

const router = Router();
router.use(verifyToken);

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['company_admin','accountant','manager','cashier','staff']).default('staff'),
});

router.get('/', requireMinRole('manager'), ctrl.listUsers);
router.post('/', requireMinRole('company_admin'), validateBody(createSchema), ctrl.createUser);
router.post('/sync-employee-profiles', requireMinRole('company_admin'), ctrl.syncEmployeeProfiles);
router.patch('/:id', requireMinRole('company_admin'), ctrl.updateUser);
router.delete('/:id', requireMinRole('company_admin'), ctrl.deleteUser);

export default router;
