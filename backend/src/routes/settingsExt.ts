import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/settingsExtController';

const router = Router();
router.use(verifyToken);

router.get('/party-groups', ctrl.listPartyGroups);
router.post('/party-groups', requireMinRole('manager'), ctrl.createPartyGroup);
router.delete('/party-groups/:id', requireMinRole('manager'), ctrl.deletePartyGroup);

router.get('/party-custom-fields', ctrl.listPartyCustomFieldDefs);
router.post('/party-custom-fields', requireMinRole('manager'), ctrl.createPartyCustomFieldDef);
router.delete('/party-custom-fields/:id', requireMinRole('manager'), ctrl.deletePartyCustomFieldDef);

router.get('/message-templates', ctrl.listMessageTemplates);
router.post('/message-templates', requireMinRole('manager'), ctrl.saveMessageTemplate);

router.get('/loyalty', ctrl.getLoyaltySettings);
router.patch('/loyalty', requireMinRole('manager'), ctrl.updateLoyaltySettings);
router.get('/loyalty/:partyId/balance', ctrl.getPartyLoyaltyBalance);
router.post('/loyalty/:partyId/redeem', ctrl.redeemLoyaltyPoints);

router.get('/exchange-rates', ctrl.listExchangeRates);
router.post('/exchange-rates', requireMinRole('manager'), ctrl.setExchangeRate);
router.post('/exchange-rates/fetch-live', requireMinRole('manager'), ctrl.fetchLiveExchangeRates);

router.patch('/enforcement', requireMinRole('company_admin'), ctrl.updateEnforcementSettings);

export default router;
