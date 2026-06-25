import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import * as ctrl from '../controllers/proformaController';

const router = Router();
router.use(verifyToken);

// Create/edit/delete/print/PDF/WhatsApp/Email all reuse the existing
// real /invoices endpoints with invoice_type=proforma — building a
// parallel CRUD here would be exactly the duplication this audit
// flagged against. Only the genuinely proforma-specific actions live
// in this router.
router.get('/', ctrl.listProformas);
router.patch('/:id/status', requireMinRole('staff'), ctrl.updateProformaStatus);
router.post('/:id/duplicate', requireMinRole('staff'), ctrl.duplicateProforma);
router.post('/:id/convert', requireMinRole('staff'), ctrl.convertProformaToInvoice);

export default router;
