import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import * as ctrl from '../controllers/reportController';

const router = Router();
router.use(verifyToken);

router.get('/dashboard', ctrl.getDashboard);
router.get('/profit-loss', ctrl.profitLoss);
router.get('/gst', ctrl.gstReport);
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
router.get('/party-wise-purchase', ctrl.partyWisePurchase);
router.get('/day-book', ctrl.dayBook);
router.get('/expense-summary', ctrl.expenseSummary);
router.get('/payment-collection', ctrl.paymentCollection);
router.get('/tcs-tds', ctrl.tcsTds);
router.get('/balance-sheet', ctrl.balanceSheet);
router.get('/trial-balance', ctrl.trialBalance);

export default router;
