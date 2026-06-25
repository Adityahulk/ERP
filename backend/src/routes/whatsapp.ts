import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/whatsappController';
import * as campaignCtrl from '../controllers/campaignController';

const router = Router();
router.use(verifyToken);

router.get('/settings', ctrl.getWhatsappSettings);
router.patch('/mode', requireMinRole('manager'), ctrl.setWhatsappMode);
router.patch('/twilio-config', requireMinRole('manager'), ctrl.setTwilioConfig);
router.post('/test-connection', requireMinRole('manager'), ctrl.testTwilioConnection);
router.patch('/cloud-config', requireMinRole('manager'), ctrl.setCloudApiConfig);
router.post('/test-cloud-connection', requireMinRole('manager'), ctrl.testCloudConnection);
router.get('/dashboard', ctrl.getWhatsappDashboard);
router.get('/logs', ctrl.getWhatsappLogs);

// Campaigns reuse the existing, already-real campaign controller —
// not duplicated here.
router.get('/campaigns', campaignCtrl.listCampaigns);
router.get('/campaigns/:id', campaignCtrl.getCampaign);
router.post('/campaigns', campaignCtrl.createCampaign);
router.post('/campaigns/:id/send', requireMinRole('manager'), campaignCtrl.sendCampaign);
router.delete('/campaigns/:id', requireMinRole('manager'), campaignCtrl.deleteCampaign);

export default router;
