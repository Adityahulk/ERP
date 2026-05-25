import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/invoiceController';
import { uploadInvoiceAttachment } from '../services/fileUpload';

const router = Router();
router.use(verifyToken);

router.post('/search-items', ctrl.searchItems);
router.post('/scan-barcode', ctrl.scanBarcode);
router.get('/', ctrl.listInvoices);
router.get('/next-number', ctrl.getNextInvoiceNumber);
router.post('/', ctrl.createInvoice);
router.post('/preview-pdf', ctrl.previewInvoicePdf);
router.post('/bulk-sales-pdf', ctrl.getBulkSalesInvoicePDF);

router.get('/:id/pdf', ctrl.getInvoicePDF);
router.post('/:id/whatsapp', ctrl.sendWhatsApp);
router.post('/:id/einvoice/generate', requireMinRole('accountant'), ctrl.generateEinvoice);
router.post('/:id/einvoice/cancel', requireMinRole('company_admin'), ctrl.cancelEinvoice);
router.get('/:id/einvoice/pdf', ctrl.getEinvoicePdf);
router.post('/:id/ewaybill/generate', requireMinRole('accountant'), ctrl.generateEwayBill);
router.post('/:id/ewaybill/cancel', requireMinRole('company_admin'), ctrl.cancelEwayBill);
router.post('/:id/payment', ctrl.recordPayment);
router.post('/:id/attachments', uploadInvoiceAttachment, ctrl.addInvoiceAttachment);

router.patch('/:id', requireMinRole('manager'), ctrl.updateInvoice);
router.get('/:id', ctrl.getInvoice);
router.patch('/:id/cancel', requireMinRole('manager'), ctrl.cancelInvoice);
router.delete('/:id', requireMinRole('company_admin'), ctrl.deleteInvoice);

export default router;
