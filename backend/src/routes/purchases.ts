import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/purchaseController';

const router = Router();
router.use(verifyToken);

router.post('/orders', requireMinRole('staff'), ctrl.createPurchaseOrder);
router.get('/orders', ctrl.listPurchaseOrders);
router.get('/orders/:id', ctrl.getPurchaseOrder);
router.patch('/orders/:id', requireMinRole('manager'), ctrl.updatePurchaseOrder);
router.post('/orders/:id/confirm', requireMinRole('manager'), ctrl.confirmPurchaseOrder);
router.post('/orders/:id/cancel', requireMinRole('manager'), ctrl.cancelPurchaseOrder);
router.post('/orders/:id/receive', requireMinRole('staff'), ctrl.receiveStock);

router.get('/invoices', ctrl.listPurchaseInvoices);
router.post('/invoices', requireMinRole('staff'), ctrl.createPurchaseInvoiceDirect);
router.get('/invoices/:id', ctrl.getPurchaseInvoice);
router.patch('/invoices/:id', requireMinRole('manager'), ctrl.updatePurchaseInvoice);
router.post('/invoices/:id/payment', requireMinRole('manager'), ctrl.payPurchaseInvoice);
router.get('/invoices/:id/pdf', ctrl.getPurchaseInvoicePDF);

export default router;
