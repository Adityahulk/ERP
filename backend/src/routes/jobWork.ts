import { Router } from 'express';
import {
  createChallan, listChallans, getChallan, sendChallan, receiveChallan, cancelChallan,
  downloadChallanPdf, listOverdue, jobWorkRegister
} from '../controllers/jobWorkController';

const router = Router();

router.get('/overdue', listOverdue);
router.get('/register', jobWorkRegister);

router.post('/challans', createChallan);
router.get('/challans', listChallans);
router.get('/challans/:id/pdf', downloadChallanPdf);
router.get('/challans/:id', getChallan);
router.post('/challans/:id/send', sendChallan);
router.post('/challans/:id/receive', receiveChallan);
router.post('/challans/:id/cancel', cancelChallan);

export default router;
