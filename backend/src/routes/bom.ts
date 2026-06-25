import { Router } from 'express';
import { createBOM, listBOMs, getBOM, updateBOM, deleteBOM, produceBOM, listProductionLogs } from '../controllers/bomController';

const router = Router();

router.get('/production-logs', listProductionLogs);
router.post('/', createBOM);
router.get('/', listBOMs);
router.get('/:id', getBOM);
router.patch('/:id', updateBOM);
router.delete('/:id', deleteBOM);
router.post('/:id/produce', produceBOM);

export default router;
