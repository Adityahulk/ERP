import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/saleReturnController';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.listSaleReturns);
router.post('/', ctrl.createSaleReturn);

export default router;
