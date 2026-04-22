import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import * as ctrl from '../controllers/itemCategoryController';

const router = Router();
router.use(verifyToken);

const catSchema = z.object({
  name: z.string().min(1, 'Category name is required'),
  parent_id: z.string().uuid().nullable().optional(),
  description: z.string().optional(),
});

router.get('/', ctrl.listCategories);
router.post('/', validateBody(catSchema), ctrl.createCategory);
router.patch('/:id', ctrl.updateCategory);
router.delete('/:id', ctrl.deleteCategory);

export default router;
