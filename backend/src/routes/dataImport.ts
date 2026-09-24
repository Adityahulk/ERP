import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { uploadImportFile } from '../services/fileUpload';
import { downloadImportTemplate, importData } from '../controllers/dataImportController';

const router = Router();
router.use(verifyToken, requireMinRole('company_admin'));

router.get('/template/:type', downloadImportTemplate);
router.post('/:type', uploadImportFile, importData);

export default router;
