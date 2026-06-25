import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/searchController';

const router = Router();
router.use(verifyToken);
router.get('/', ctrl.globalSearch);
export default router;
