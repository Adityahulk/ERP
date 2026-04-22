import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import * as ctrl from '../controllers/itemUnitController';

const router = Router();
router.use(verifyToken);

const unitSchema = z.object({
  name: z.string().min(1).max(50),
  abbreviation: z.string().max(10).optional(),
  is_default: z.boolean().optional(),
});

router.get('/', ctrl.listUnits);
router.post('/', validateBody(unitSchema), ctrl.createUnit);
router.patch('/:id', ctrl.updateUnit);

export default router;
