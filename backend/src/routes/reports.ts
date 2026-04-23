import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/reportController';

const router = Router();
router.use(verifyToken);

router.get('/dashboard', ctrl.getDashboard);
router.get('/profit-loss', requireMinRole('accountant'), ctrl.profitLoss);
router.get('/gst', requireMinRole('accountant'), ctrl.gstReport);
router.get('/party-statement', ctrl.partyStatement);
router.get('/sales-register', ctrl.salesRegister);
router.get('/purchase-register', ctrl.purchaseRegister);
router.get('/stock-summary', ctrl.stockSummary);
router.get('/outstanding-receivables', ctrl.outstandingReceivables);
router.get('/outstanding-payables', ctrl.outstandingPayables);
router.get('/stock-movement', ctrl.stockMovement);
router.get('/low-stock', ctrl.lowStock);
router.get('/item-wise-profit', ctrl.itemWiseProfit);
router.get('/party-wise-sales', ctrl.partyWiseSales);
router.get('/day-book', ctrl.dayBook);
router.get('/expense-summary', ctrl.expenseSummary);
router.get('/payment-collection', ctrl.paymentCollection);
router.get('/tcs-tds', ctrl.tcsTds);

export default router;
