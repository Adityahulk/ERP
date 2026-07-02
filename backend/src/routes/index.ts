import { Router } from 'express';
import authRoutes from './auth';
import registrationRoutes from './registration';
import licenseRoutes from './license';
import companyRoutes from './company';
import godownRoutes from './godowns';
import userRoutes from './users';
import itemCategoryRoutes from './itemCategories';
import itemUnitRoutes from './itemUnits';
import itemRoutes from './items';
import stockRoutes from './stock';
import partyRoutes from './parties';
import invoiceRoutes from './invoices';
import paymentRoutes from './payments';
import expenseRoutes from './expenses';
import reportRoutes from './reports';
import quotationRoutes from './quotations';
import purchaseRoutes from './purchases';
import accountingRoutes from './accounting';
import gstRoutes from './gst';
import employeeRoutes from './employees';
import attendanceRoutes from './attendance';
import leaveRoutes from './leaves';
import notificationRoutes from './notifications';
import labelRoutes from './labels';
import printRoutes from './print';
import searchRoutes from './search';
import chatRoutes from './chat';
import bomRoutes from './bom';
import wholesaleRoutes from './wholesale';
import jobWorkRoutes from './jobWork';
import ocrRoutes from './ocr';
import salesOrderRoutes from './salesOrders';
import deliveryChallanRoutes from './deliveryChallans';
import saleReturnRoutes from './saleReturns';
import superAdminRoutes from './superAdmin';
import transactionSettingsRoutes from './transactionSettings';
import taxSettingsRoutes from './taxSettings';
import printSettingsRoutes from './printSettings';

import { verifyToken } from '../middleware/auth';
import barcodeRoutes from './barcode';
import posScannerRoutes from './posScanner';
import { moduleGuard } from '../middleware/moduleGuard';
import { getDashboard } from '../controllers/reportController';

const router = Router();

// ── Module routes ─────────────────────────────────────────────
// Core (always available — no license feature required)
router.use('/auth', authRoutes);
router.use('/superadmin', superAdminRoutes);
router.use('/register', registrationRoutes);
router.use('/licenses', licenseRoutes);
router.use('/company', companyRoutes);
router.use('/settings/transaction', transactionSettingsRoutes);
router.use('/settings/taxes', taxSettingsRoutes);
router.use('/settings/print', printSettingsRoutes);
router.use('/godowns', godownRoutes);
router.use('/users', userRoutes);
router.use('/item-categories', itemCategoryRoutes);
router.use('/item-units', itemUnitRoutes);
router.use('/items', itemRoutes);
router.use('/stock', stockRoutes);
router.use('/parties', partyRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/quotations', quotationRoutes);
router.use('/purchases', purchaseRoutes);
router.use('/labels', labelRoutes);
router.use('/print', printRoutes);
router.use('/search', searchRoutes);
router.use('/chat', chatRoutes);
router.use('/accounting', accountingRoutes);
router.use('/notifications', notificationRoutes);
router.use('/sales/orders', salesOrderRoutes);
router.use('/sales/challans', deliveryChallanRoutes);
router.use('/sales/returns', saleReturnRoutes);
router.use('/barcode', barcodeRoutes);
router.use('/pos-scanner', posScannerRoutes);

// Dashboard is always accessible — no module guard (it's the home screen)
router.get('/reports/dashboard', verifyToken, getDashboard);

// Tier-gated modules — verify JWT before moduleGuard (guard needs req.user)
router.use('/reports', verifyToken, moduleGuard('reports'), reportRoutes);
router.use('/expenses', verifyToken, moduleGuard('expenses'), expenseRoutes);
router.use('/gst', verifyToken, moduleGuard('gst'), gstRoutes);
router.use('/employees', verifyToken, moduleGuard('employees'), employeeRoutes);
router.use('/attendance', verifyToken, moduleGuard('attendance'), attendanceRoutes);
router.use('/leaves', verifyToken, moduleGuard('leaves'), leaveRoutes);
router.use('/bom', verifyToken, moduleGuard('bom'), bomRoutes);
router.use('/wholesale', verifyToken, moduleGuard('wholesale'), wholesaleRoutes);
router.use('/job-work', verifyToken, moduleGuard('job-work'), jobWorkRoutes);
router.use('/ocr', verifyToken, moduleGuard('ocr'), ocrRoutes);

// API info
router.get('/', (_req, res) => {
  res.json({
    name: 'BizFlow API',
    version: '2.0.0',
    description: 'Indian Manufacturing Business API',
    modules: {
      active: [
        'auth', 'company', 'godowns', 'users',
        'item-categories', 'item-units', 'items', 'stock',
        'parties', 'invoices', 'quotations', 'payments', 'expenses', 'reports', 'search',
        'bom', 'wholesale', 'job-work',
      ],
    },
  });
});

export default router;
