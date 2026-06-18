import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { uploadImportFile } from '../services/fileUpload';
import * as ctrl from '../controllers/bankReconciliationController';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.listSessions);
router.post('/', ctrl.createSession);
router.get('/:sessionId', ctrl.getSession);
router.post('/:sessionId/upload', uploadImportFile, ctrl.uploadStatement);
router.post('/:sessionId/auto-match', ctrl.autoMatch);
router.post('/:sessionId/match', ctrl.manualMatch);
router.post('/:sessionId/unmatch', ctrl.unmatch);
router.patch('/:sessionId/complete', ctrl.completeSession);

export default router;
