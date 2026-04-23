import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { validateBody } from '../middleware/validate';
import * as ctrl from '../controllers/invoiceController';

const router = Router();
router.use(verifyToken);

router.post('/search-items', ctrl.searchItems);
router.post('/scan-barcode', ctrl.scanBarcode);
router.get('/', ctrl.listInvoices);
router.post('/', ctrl.createInvoice);
router.get('/:id', ctrl.getInvoice);
router.patch('/:id/cancel', requireMinRole('manager'), ctrl.cancelInvoice);
router.delete('/:id', requireMinRole('company_admin'), ctrl.deleteInvoice);

router.get('/:id/pdf', ctrl.getInvoicePDF);
router.post('/:id/whatsapp', ctrl.sendWhatsApp);
router.post('/:id/einvoice', ctrl.generateEInvoice);
router.post('/:id/payment', ctrl.recordPayment);

export default router;
