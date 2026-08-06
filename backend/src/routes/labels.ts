import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { requireMinRole } from '../middleware/role';
import { query } from '../config/db';
import { generateLabelsPDF } from '../services/labelService';
import { getOrCreateItemBarcode, registerItemBarcodeAlias } from '../utils/barcodeUtils';

const router = Router();
router.use(verifyToken);

const VALID_TEMPLATES = new Set(['58x40', '80x50', '100x50', '116x40', '100x100', '50x25', 'a4']);

function labelProfileConfig(body: any, item: any) {
  if (item.labelConfig && typeof item.labelConfig === 'object' && !Array.isArray(item.labelConfig)) {
    return item.labelConfig;
  }
  return {
    printMode: body.mode || 'general_printer',
    size: body.size || '58x40',
    labelsPerPage: Number(body.labels_per_page || 0) || undefined,
    templateId: body.templateId || undefined,
    orientation: body.orientation || 'horizontal',
    brandName: item.label_brand || body.customCompanyName || '',
    line1: item.label_line1,
    line2: item.label_line2,
    line3: item.label_line3,
    line4: item.label_line4,
    line5: item.label_line5,
    line6: item.label_line6,
    price: item.price,
    currency: item.currency || 'INR',
    showBarcode: item.showBarcode !== false,
    showBarcodeText: item.showBarcodeText !== false,
    barcodeSource: item.barcodeSource === 'custom' ? 'custom' : 'system',
    customBarcodeValue: item.barcodeSource === 'custom' ? String(item.customBarcodeValue || '').trim() : '',
  };
}

router.get('/profile/:itemId', async (req: Request, res: Response) => {
  try {
    const companyId = req.user!.company_id;
    const item = await query(
      `SELECT id, barcode
       FROM items
       WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [req.params.itemId, companyId],
    );
    if (!item.rows.length) return res.status(404).json({ success: false, error: 'Item not found' });
    const profile = await query(
      `SELECT config, updated_at
       FROM barcode_label_profiles
       WHERE company_id = $1 AND item_id = $2`,
      [companyId, req.params.itemId],
    );
    res.json({
      success: true,
      data: {
        systemBarcode: item.rows[0].barcode || null,
        config: profile.rows[0]?.config || null,
        updatedAt: profile.rows[0]?.updated_at || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to load label profile' });
  }
});

router.put('/profile/:itemId', requireMinRole('staff'), async (req: Request, res: Response) => {
  try {
    const companyId = req.user!.company_id;
    const itemId = req.params.itemId;
    const config = req.body?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return res.status(400).json({ success: false, error: 'A label configuration is required' });
    }
    if (JSON.stringify(config).length > 32_000) {
      return res.status(400).json({ success: false, error: 'Label configuration is too large' });
    }
    if (config.barcodeSource === 'custom') {
      await registerItemBarcodeAlias(itemId, companyId, config.customBarcodeValue);
    } else {
      await getOrCreateItemBarcode(itemId, companyId);
    }
    await query(
      `INSERT INTO barcode_label_profiles (company_id, item_id, config, updated_by)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (company_id, item_id) DO UPDATE
         SET config = EXCLUDED.config,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
      [companyId, itemId, JSON.stringify(config), req.user!.id],
    );
    res.json({ success: true, data: { config } });
  } catch (err: any) {
    const status = /not found|already assigned|cannot be empty|unsupported|exceed/i.test(err.message) ? 400 : 500;
    res.status(status).json({ success: false, error: err.message || 'Failed to save label profile' });
  }
});

router.post('/bulk', requireMinRole('staff'), async (req: Request, res: Response) => {
   try {
     const { items, size, mode, labels_per_page, templateId, orientation: bodyOrientation, customCompanyName } = req.body;
     // Accept orientation from query string OR request body (frontend may use either)
     const orientation = (req.query.orientation || bodyOrientation) as 'horizontal' | 'vertical' | undefined;
     const companyId = req.user!.company_id;

     if (!Array.isArray(items) || !items.length) {
       return res.status(400).json({ success: false, error: 'No items provided' });
     }
     const template = String(size || '58x40');
     if (!VALID_TEMPLATES.has(template)) {
       return res.status(400).json({ success: false, error: 'Invalid label size template' });
     }
     if (mode && !['general_printer', 'label_printer'].includes(String(mode))) {
       return res.status(400).json({ success: false, error: 'Invalid print mode' });
     }
     const labelsPerPageNum = Number(labels_per_page || 0);
     if (mode === 'general_printer' && labelsPerPageNum && (!Number.isInteger(labelsPerPageNum) || labelsPerPageNum < 1 || labelsPerPageNum > 100)) {
       return res.status(400).json({ success: false, error: 'General printer labels per page must be a whole number between 1 and 100' });
     }
     if (mode === 'label_printer' && labelsPerPageNum && ![1, 2].includes(labelsPerPageNum)) {
       return res.status(400).json({ success: false, error: 'Label printer supports only 1 or 2 labels per page' });
     }

     const printQueue = [];

     // Batch-fetch item metadata
     const ids = items.map((i: any) => i.item_id).filter(Boolean);
     if (!ids.length) return res.status(400).json({ success: false, error: 'Missing item ids in payload' });
     const [itemDetails, companyRes] = await Promise.all([
       query(
         `SELECT id, name, barcode, sku, hsn_code, selling_price, gst_rate
          FROM items
          WHERE id = ANY($1::uuid[]) AND company_id = $2`,
         [ids, companyId],
       ),
       query(`SELECT name FROM companies WHERE id = $1`, [companyId]),
     ]);
     const companyName = companyRes.rows[0]?.name || 'My Company';

     // Generate/Get barcodes for all items in sequence
     const barcodeMap = new Map<string, string>();
     for (const id of ids) {
       try {
         const bc = await getOrCreateItemBarcode(id, companyId);
         barcodeMap.set(id, bc);
       } catch (err: any) {
         console.error(`Failed to generate barcode for item ${id}:`, err.message);
       }
     }

     for (const reqItem of items) {
       const qty = Number(reqItem.quantity || 0);
       if (!Number.isFinite(qty) || qty <= 0) continue;
       const dbMeta = itemDetails.rows.find(
         (r: { id: string }) => r.id === reqItem.item_id
       );
       if (dbMeta) {
         if (reqItem.barcodeSource === 'custom') {
           await registerItemBarcodeAlias(dbMeta.id, companyId, reqItem.customBarcodeValue);
         }
         const itemBarcode = barcodeMap.get(dbMeta.id) || dbMeta.barcode || dbMeta.sku || 'LABEL';
         const finalBarcode = (reqItem.barcodeSource === 'custom' && reqItem.customBarcodeValue)
           ? reqItem.customBarcodeValue
           : itemBarcode;

         for (let i = 0; i < qty; i++) {
           printQueue.push({
             ...dbMeta,
             sku: finalBarcode,
             company_name: companyName,
             // Internal field: passes barcode string to labelService
             _smart_barcode_str: finalBarcode,
             // Label Editor overrides — all optional free text, no calculations
             // Priority: per-item label_brand > top-level customCompanyName > DB company name
             label_brand: reqItem.label_brand != null
               ? reqItem.label_brand
               : (customCompanyName != null ? customCompanyName : undefined),
             label_line1: reqItem.label_line1  ?? undefined,
             label_line2: reqItem.label_line2  ?? undefined,
             label_line3: reqItem.label_line3  ?? undefined,
             label_line4: reqItem.label_line4  ?? undefined,
             label_line5: reqItem.label_line5  ?? undefined,
             label_line6: reqItem.label_line6  ?? undefined,
             price: reqItem.price ?? undefined,
             currency: reqItem.currency ?? 'INR',
             showBarcode: reqItem.showBarcode !== false,
             showBarcodeText: reqItem.showBarcodeText !== false,
             barcodeSource: reqItem.barcodeSource || 'system',
             customBarcodeValue: reqItem.customBarcodeValue || '',
           });
         }

         const profile = labelProfileConfig(
           { mode, size: template, labels_per_page, templateId, orientation, customCompanyName },
           reqItem,
         );
         await query(
           `INSERT INTO barcode_label_profiles (company_id, item_id, config, updated_by)
            VALUES ($1, $2, $3::jsonb, $4)
            ON CONFLICT (company_id, item_id) DO UPDATE
              SET config = EXCLUDED.config,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = now()`,
           [companyId, dbMeta.id, JSON.stringify(profile), req.user!.id],
         );
       }
     }

     if (!printQueue.length) return res.status(404).json({ success: false, error: 'No valid items found' });

     const pdfBuffer = await generateLabelsPDF(template as '58x40' | '80x50' | '100x50' | '116x40' | '100x100' | 'a4', printQueue, {
       mode: mode === 'label_printer' ? 'label_printer' : 'general_printer',
       labelsPerPage: labelsPerPageNum || undefined,
       templateId: templateId || undefined,
       orientation: orientation,
     });

     res.setHeader('Content-Type', 'application/pdf');
     res.setHeader('Content-Disposition', `attachment; filename=labels-${Date.now()}.pdf`);
     res.status(200).send(pdfBuffer);
   } catch (err: any) {
     console.error('labels route error:', err.message, err.detail, err.position);
     res.status(500).json({ success: false, error: err.message || 'Failed to generate labels' });
   }
});

export default router;
