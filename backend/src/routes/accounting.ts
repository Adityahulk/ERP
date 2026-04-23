import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/accountingController';

const router = Router();
router.use(verifyToken);

router.get('/accounts', ctrl.getAccounts);
router.post('/accounts', requireMinRole('accountant'), ctrl.createAccount);
router.patch('/accounts/:id', requireMinRole('accountant'), ctrl.updateAccount);
router.delete('/accounts/:id', requireMinRole('accountant'), ctrl.deleteAccount);

router.post('/journal-entries', requireMinRole('accountant'), ctrl.createJournalEntry);
router.get('/journal-entries', ctrl.listJournalEntries);
router.get('/journal-entries/:id', ctrl.getJournalEntry);
router.post('/journal-entries/:id/reverse', requireMinRole('accountant'), ctrl.reverseJournalEntry);

router.get('/accounts/:id/ledger', ctrl.getLedger);

export default router;
