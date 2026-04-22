import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { validateBody } from '../middleware/validate';
import * as ctrl from '../controllers/partyController';

const router = Router();
router.use(verifyToken);

const createSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  party_type: z.enum(['customer', 'supplier', 'both']).default('customer'),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  gstin: z.string().max(15).optional().or(z.literal('')),
  pan: z.string().max(10).optional(),
  billing_address: z.string().optional(),
  shipping_address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().max(10).optional(),
  state_code: z.string().max(3).optional(),
  credit_limit: z.number().int().min(0).optional(),
  payment_terms: z.number().int().min(0).max(365).optional(),
  opening_balance: z.number().int().optional(),
  contact_person: z.string().optional(),
  notes: z.string().optional(),
  custom_fields: z.record(z.any()).optional(),
});

// Static routes first
router.get('/search', ctrl.searchParties);

// CRUD
router.get('/', ctrl.listParties);
router.post('/', validateBody(createSchema), ctrl.createParty);
router.get('/:id', ctrl.getParty);
router.patch('/:id', ctrl.updateParty);
router.delete('/:id', requireMinRole('manager'), ctrl.deleteParty);
router.get('/:id/ledger', ctrl.getPartyLedger);

export default router;
