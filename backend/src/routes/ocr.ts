import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { extractOcrData, ocrUpload } from '../controllers/ocrController';

const router = Router();
router.use(verifyToken);

/** POST /api/ocr/extract  — multipart/form-data, field name: "file" */
router.post('/extract', ocrUpload.single('file'), extractOcrData);

export default router;
