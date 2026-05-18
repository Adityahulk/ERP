import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/quotationController';

const router = Router();
router.use(verifyToken);

router.post('/', ctrl.createQuotation);
router.get('/', ctrl.listQuotations);
router.get('/:id', ctrl.getQuotation);
router.post('/:id/whatsapp', ctrl.shareQuotationWhatsApp);
router.post('/:id/email', ctrl.shareQuotationEmail);
router.patch('/:id', ctrl.updateQuotationStatus);
router.post('/:id/convert', ctrl.convertToInvoice);

export default router;
