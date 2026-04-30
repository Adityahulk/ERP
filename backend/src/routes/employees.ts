import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { uploadEmployeeDocument } from '../services/fileUpload';
import * as ctrl from '../controllers/employeeController';

const router = Router();
router.use(verifyToken);

router.get('/me', ctrl.getMyProfile);
router.patch('/me', ctrl.updateEmployeeProfile);
router.post('/me/documents', uploadEmployeeDocument, ctrl.uploadEmployeeDocument);

router.get('/', requireMinRole('manager'), ctrl.getEmployees);
router.post('/', requireMinRole('company_admin'), ctrl.createEmployee);
router.get('/:userId', ctrl.getEmployeeProfile);
router.patch('/:userId', requireMinRole('manager'), ctrl.updateEmployeeProfile);
router.post('/:userId/documents', uploadEmployeeDocument, ctrl.uploadEmployeeDocument);
router.post('/:userId/salary-adjustments', requireMinRole('accountant'), ctrl.addSalaryAdjustment);
router.post('/:userId/salary-slips', requireMinRole('accountant'), ctrl.generateSalarySlip);
router.post('/:userId/resign', requireMinRole('company_admin'), ctrl.resignEmployee);

export default router;
