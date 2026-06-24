import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/printController';

const router = Router();
router.use(verifyToken);

router.get('/receipt/:invoiceId', ctrl.getReceiptPdf);
router.get('/thermal-invoice/:invoiceId', ctrl.getThermalInvoicePdf);
router.get('/quotation/:quotationId', ctrl.getQuotationPdf);

export default router;
