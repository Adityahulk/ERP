import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/purchaseController';

const router = Router();
router.use(verifyToken);

router.post('/orders', ctrl.createPurchaseOrder);
router.get('/orders', ctrl.listPurchaseOrders);
router.get('/orders/:id', ctrl.getPurchaseOrder);
router.patch('/orders/:id', ctrl.updatePurchaseOrder);
router.post('/orders/:id/confirm', ctrl.confirmPurchaseOrder);
router.post('/orders/:id/cancel', ctrl.cancelPurchaseOrder);
router.post('/orders/:id/receive', ctrl.receiveStock);

router.get('/invoices', ctrl.listPurchaseInvoices);
router.post('/invoices', ctrl.createPurchaseInvoiceDirect);
router.get('/invoices/:id', ctrl.getPurchaseInvoice);
router.patch('/invoices/:id', ctrl.updatePurchaseInvoice);
router.post('/invoices/:id/payment', ctrl.payPurchaseInvoice);
router.get('/invoices/:id/pdf', ctrl.getPurchaseInvoicePDF);

export default router;
