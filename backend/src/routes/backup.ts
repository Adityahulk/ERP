import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/backupController';

const router = Router();
router.use(verifyToken);

router.get('/dashboard', ctrl.getSyncShareDashboard);
router.get('/history', ctrl.getBackupHistory);
router.post('/run', requireMinRole('manager'), ctrl.runBackupNow);
router.get('/:jobRunId/download', requireMinRole('manager'), ctrl.downloadBackup);
router.get('/schedule', ctrl.getBackupSchedule);
router.patch('/schedule', requireMinRole('manager'), ctrl.setBackupSchedule);
router.post('/:jobRunId/upload/:provider', requireMinRole('manager'), ctrl.uploadBackupToProvider);
router.get('/:jobRunId/restore/preview', requireMinRole('manager'), ctrl.previewRestore);
router.post('/:jobRunId/restore/apply', requireMinRole('company_admin'), ctrl.applyRestore);
router.get('/restore-history', ctrl.getRestoreHistory);

export default router;
