import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { validateBody } from '../middleware/validate';
import * as ctrl from '../controllers/godownController';

const router = Router();
router.use(verifyToken);

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  code: z.string().max(20).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().max(10).optional(),
  gstin: z.string().max(15).optional(),
  phone: z.string().optional(),
  manager_id: z.string().uuid().optional(),
  is_default: z.boolean().optional(),
});

router.get('/', ctrl.listGodowns);
router.post('/', requireMinRole('company_admin'), validateBody(createSchema), ctrl.createGodown);
router.patch('/:id', requireMinRole('company_admin'), ctrl.updateGodown);
router.delete('/:id', requireMinRole('company_admin'), ctrl.deleteGodown);

export default router;
