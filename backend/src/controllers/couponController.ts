import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';

// ── POST /api/coupons/validate ─────────────────────────────────────
export async function validateCoupon(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const code = String(req.body?.code || '').trim().toUpperCase();
    const purchaseAmount = Number(req.body?.purchase_amount_paise || 0);
    if (!code) return res.status(400).json(error('Enter a coupon code'));

    const result = await query(
      `SELECT * FROM coupon_codes WHERE company_id = $1 AND code = $2 AND is_active = true`,
      [companyId, code],
    );
    if (!result.rows.length) return res.status(404).json(error('Invalid coupon code'));
    const c = result.rows[0];

    const today = new Date().toISOString().split('T')[0];
    if (c.valid_from > today) return res.status(400).json(error('This coupon is not active yet'));
    if (c.valid_until && c.valid_until < today) return res.status(400).json(error('This coupon has expired'));
    if (c.usage_limit != null && c.used_count >= c.usage_limit) return res.status(400).json(error('This coupon has reached its usage limit'));
    if (purchaseAmount < Number(c.min_purchase_paise)) {
      return res.status(400).json(error(`Minimum purchase of \u20b9${(Number(c.min_purchase_paise) / 100).toFixed(2)} required for this coupon`));
    }

    let discount = c.discount_type === 'flat'
      ? Math.round(Number(c.discount_value) * 100)
      : Math.round(purchaseAmount * Number(c.discount_value) / 100);
    if (c.max_discount_paise != null) discount = Math.min(discount, Number(c.max_discount_paise));
    discount = Math.min(discount, purchaseAmount);

    res.json(success({ couponId: c.id, code: c.code, discountPaise: discount, discountType: c.discount_type, discountValue: c.discount_value }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/coupons ────────────────────────────────────────────────
export async function listCoupons(req: Request, res: Response) {
  try {
    const rows = await query(`SELECT * FROM coupon_codes WHERE company_id = $1 ORDER BY created_at DESC`, [req.user!.company_id]);
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/coupons ───────────────────────────────────────────────
export async function createCoupon(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    const code = String(d.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json(error('Coupon code is required'));
    if (!d.discount_value || Number(d.discount_value) <= 0) return res.status(400).json(error('discount_value must be greater than 0'));
    const result = await query(
      `INSERT INTO coupon_codes (company_id, code, discount_type, discount_value, min_purchase_paise, max_discount_paise, usage_limit, valid_from, valid_until, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        companyId, code, d.discount_type === 'flat' ? 'flat' : 'percent', Number(d.discount_value),
        Math.round(Number(d.min_purchase || 0) * 100), d.max_discount ? Math.round(Number(d.max_discount) * 100) : null,
        d.usage_limit || null, d.valid_from || new Date().toISOString().split('T')[0], d.valid_until || null, req.user!.id,
      ],
    );
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) {
    res.status(/duplicate|unique/i.test(err.message) ? 400 : 500).json(error(/unique/i.test(err.message) ? 'A coupon with this code already exists' : err.message));
  }
}

export async function deactivateCoupon(req: Request, res: Response) {
  try {
    await query(`UPDATE coupon_codes SET is_active = false WHERE id = $1 AND company_id = $2`, [req.params.id, req.user!.company_id]);
    res.json(success({ deactivated: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

/** Called from invoice creation when a coupon was applied — atomic
 * with the sale since the caller passes the same transaction client. */
export async function recordCouponRedemption(client: any, companyId: string, couponId: string, invoiceId: string, discountAppliedPaise: number) {
  await client.query(`UPDATE coupon_codes SET used_count = used_count + 1 WHERE id = $1 AND company_id = $2`, [couponId, companyId]);
  await client.query(
    `INSERT INTO coupon_redemptions (coupon_id, invoice_id, company_id, discount_applied_paise) VALUES ($1,$2,$3,$4)`,
    [couponId, invoiceId, companyId, discountAppliedPaise],
  );
}
