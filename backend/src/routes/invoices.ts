import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/invoiceController';

const router = Router();
router.use(verifyToken);

router.post('/search-items', ctrl.searchItems);
router.post('/scan-barcode', ctrl.scanBarcode);
router.get('/', ctrl.listInvoices);
router.post('/', ctrl.createInvoice);

router.get('/:id/pdf', ctrl.getInvoicePDF);
router.post('/:id/whatsapp', ctrl.sendWhatsApp);
router.post('/:id/einvoice/generate', requireMinRole('accountant'), ctrl.generateEinvoice);
router.post('/:id/einvoice/cancel', requireMinRole('company_admin'), ctrl.cancelEinvoice);
router.get('/:id/einvoice/pdf', ctrl.getEinvoicePdf);
router.post('/:id/payment', ctrl.recordPayment);

router.get('/:id', ctrl.getInvoice);
router.patch('/:id/cancel', requireMinRole('manager'), ctrl.cancelInvoice);
router.delete('/:id', requireMinRole('company_admin'), ctrl.deleteInvoice);

export default router;
