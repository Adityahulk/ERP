import { Router } from 'express';
import authRoutes from './auth';
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

const router = Router();

// ── Module routes ─────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/company', companyRoutes);
router.use('/godowns', godownRoutes);
router.use('/users', userRoutes);
router.use('/item-categories', itemCategoryRoutes);
router.use('/item-units', itemUnitRoutes);
router.use('/items', itemRoutes);
router.use('/stock', stockRoutes);
router.use('/parties', partyRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/expenses', expenseRoutes);
router.use('/reports', reportRoutes);

// Future modules (uncomment when built):
// router.use('/quotations', quotationRoutes);
// router.use('/employees', employeeRoutes);
// router.use('/e-invoice', eInvoiceRoutes);

// API info
router.get('/', (_req, res) => {
  res.json({
    name: 'BizFlow API',
    version: '1.0.0',
    description: 'Generic Indian Business ERP API',
    modules: {
      active: [
        'auth', 'company', 'godowns', 'users',
        'item-categories', 'item-units', 'items', 'stock',
        'parties', 'invoices', 'payments', 'expenses', 'reports',
      ],
      planned: ['quotations', 'employees', 'e-invoice'],
    },
  });
});

export default router;
