import { Router } from 'express';
import { z } from 'zod';
import { verifyToken } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { uploadImportFile } from '../services/fileUpload';
import * as ctrl from '../controllers/itemController';

const router = Router();
router.use(verifyToken);

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  description: z.string().optional(),
  hsn_code: z.string().optional(),
  category_id: z.string().uuid().nullable().optional(),
  brand: z.string().optional(),
  unit_id: z.string().uuid().nullable().optional(),
  secondary_unit_id: z.string().uuid().nullable().optional(),
  unit_conversion_factor: z.coerce.number().positive().optional(),
  item_type: z.enum(['product', 'service', 'raw_material', 'finished_good', 'consumable']).default('product'),
  track_inventory: z.boolean().default(true),
  is_serialized: z.boolean().default(false),
  purchase_price: z.number().int().min(0).optional(),
  selling_price: z.number().int().min(0).optional(),
  gst_rate: z.coerce.number().min(0).max(100).default(18),
  tax_preference: z.enum(['taxable', 'exempt', 'nil_rated', 'non_gst']).default('taxable'),
  cess_rate: z.coerce.number().min(0).optional(),
  opening_stock: z.coerce.number().min(0).optional(),
  opening_stock_value: z.number().int().min(0).optional(),
  opening_stock_date: z.string().optional(),
  godown_id: z.string().uuid().optional(),
  reorder_point: z.coerce.number().min(0).optional(),
  max_stock_level: z.coerce.number().min(0).optional(),
  image_url: z.string().optional(),
  custom_fields: z.record(z.any()).optional(),
});

const scanSchema = z.object({
  barcode: z.string().min(1, 'Barcode is required'),
});

// Routes that must come BEFORE /:id to avoid param conflicts
router.get('/import-template', ctrl.importTemplate);
router.post('/bulk-import', uploadImportFile, ctrl.bulkImport);
router.post('/scan', validateBody(scanSchema), ctrl.scanBarcode);
router.get('/barcode/:code', ctrl.getItemByBarcode);

// CRUD
router.post('/', validateBody(createSchema), ctrl.createItem);
router.get('/', ctrl.listItems);
router.get('/:id', ctrl.getItem);
router.patch('/:id', ctrl.updateItem);
router.delete('/:id', ctrl.deleteItem);
router.get('/:id/barcode-image', ctrl.barcodeImage);
router.post('/:id/barcode', ctrl.getOrGenerateBarcode);

export default router;
