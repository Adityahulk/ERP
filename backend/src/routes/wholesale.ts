import { Router } from 'express';
import {
  createWholesaleOrder, listWholesaleOrders, getWholesaleOrder, updateWholesaleOrder,
  confirmWholesaleOrder, dispatchWholesaleOrder, deliverWholesaleOrder, cancelWholesaleOrder,
  listPriceTiers, upsertPriceTiers
} from '../controllers/wholesaleController';

const router = Router();

// Price tiers
router.get('/price-tiers', listPriceTiers);
router.post('/price-tiers', upsertPriceTiers);

// Wholesale orders
router.post('/', createWholesaleOrder);
router.get('/', listWholesaleOrders);
router.get('/:id', getWholesaleOrder);
router.patch('/:id', updateWholesaleOrder);
router.post('/:id/confirm', confirmWholesaleOrder);
router.post('/:id/dispatch', dispatchWholesaleOrder);
router.post('/:id/deliver', deliverWholesaleOrder);
router.post('/:id/cancel', cancelWholesaleOrder);

export default router;
