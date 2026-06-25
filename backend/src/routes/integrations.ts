import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/integrationController';

const router = Router();

// Public: the provider's OAuth server redirects the user's browser
// here directly (no Authorization header available), and providers
// POST webhooks here directly. Tenant identity is recovered from the
// signed oauth state row / webhook payload, not a JWT.
router.get('/:provider/oauth/callback', ctrl.oauthCallback);
router.post('/webhooks/:provider', ctrl.receiveWebhook);

// Everything else requires a logged-in user of the tenant.
router.use(verifyToken);
router.get('/', ctrl.listIntegrations);
router.get('/:provider/logs', ctrl.getSyncLogs);
router.get('/:provider/oauth/start', ctrl.startOAuth);
router.post('/:provider/api-key', ctrl.connectApiKey);
router.post('/:provider/disconnect', ctrl.disconnect);
router.post('/:provider/sync', ctrl.triggerSync);
router.patch('/:provider/schedule', ctrl.setSyncSchedule);

export default router;
