import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/campaignController';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.listCampaigns);
router.get('/:id', ctrl.getCampaign);
router.post('/', ctrl.createCampaign);
router.post('/:id/send', ctrl.sendCampaign);
router.delete('/:id', ctrl.deleteCampaign);

export default router;
