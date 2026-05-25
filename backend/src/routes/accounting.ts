import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/accountingController';

const router = Router();
router.use(verifyToken);

router.get('/accounts/tree', ctrl.getAccountsTree);
router.get('/accounts', ctrl.getAccounts);
router.post('/accounts', requireMinRole('accountant'), ctrl.createAccount);
router.patch('/accounts/:id', requireMinRole('accountant'), ctrl.updateAccount);
router.delete('/accounts/:id', requireMinRole('accountant'), ctrl.deleteAccount);

router.post('/journal-entries', requireMinRole('accountant'), ctrl.createJournalEntry);
router.get('/journal-entries', ctrl.listJournalEntries);
router.get('/journal-entries/:id', ctrl.getJournalEntry);
router.patch('/journal-entries/:id', requireMinRole('accountant'), ctrl.updateJournalEntry);
router.post('/journal-entries/:id/reverse', requireMinRole('accountant'), ctrl.reverseJournalEntry);

router.post('/rebuild-ledger', requireMinRole('company_admin'), ctrl.rebuildLedger);
router.get('/trial-balance', ctrl.getTrialBalance);
router.get('/profit-loss', ctrl.getProfitLoss);
router.get('/balance-sheet', ctrl.getBalanceSheet);
router.get('/cash-flow', ctrl.getCashFlow);

router.get('/cash-bank/summary', ctrl.getCashBankSummary);
router.get('/cash-bank/transactions', ctrl.getCashBankTransactions);
router.post('/cash-bank/adjustment', requireMinRole('manager'), ctrl.createCashBankAdjustment);
router.get('/cash-bank/loans', ctrl.listLoanAccounts);
router.post('/cash-bank/loans', requireMinRole('manager'), ctrl.createLoanAccount);
router.post('/cash-bank/loans/:id/transactions', requireMinRole('manager'), ctrl.recordLoanTransaction);

router.get('/accounts/:id/ledger', ctrl.getLedger);
router.get('/accounts/:id/statement', ctrl.getAccountStatement);

export default router;
