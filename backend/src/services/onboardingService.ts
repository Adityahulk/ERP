import { query } from '../config/db';

export type OnboardingSeedFlags = { items: boolean; coa: boolean; leaves: boolean };

const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh',
  '38': 'Ladakh', '97': 'Other Territory', '99': 'Other',
};

function stateLabel(code: string): string {
  return STATE_NAMES[code] || code;
}

/** Resolve GST state code to display name for company / godown records. */
export function resolveStateName(code: string): string | null {
  return STATE_NAMES[code] || null;
}

/** Ensure a default godown exists; returns its id. */
export async function ensurePrimaryGodown(
  companyId: string,
  loc: { name: string; city?: string; pincode?: string; state_code?: string },
): Promise<string> {
  const existing = await query(
    `SELECT id FROM godowns WHERE company_id = $1 AND is_deleted = false ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [companyId],
  );
  if (existing.rows.length) return existing.rows[0].id as string;

  const stateName = loc.state_code ? stateLabel(loc.state_code) : '';
  const ins = await query(
    `INSERT INTO godowns (company_id, name, code, city, pincode, state, is_default, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true, true) RETURNING id`,
    [
      companyId,
      loc.name,
      (loc.name || 'MAIN').slice(0, 8).toUpperCase().replace(/\s+/g, '-'),
      loc.city || null,
      loc.pincode || null,
      stateName || null,
    ],
  );
  return ins.rows[0].id as string;
}

export async function seedLeaveTypesIfEmpty(companyId: string): Promise<number> {
  const c = await query(
    `SELECT COUNT(*)::int AS n FROM leave_types WHERE company_id = $1`,
    [companyId],
  );
  if ((c.rows[0]?.n || 0) > 0) return 0;
  const rows = [
    ['Casual Leave', 'CL', 12, true, false, 0],
    ['Sick Leave', 'SL', 6, true, false, 0],
    ['Earned Leave', 'EL', 15, true, true, 30],
    ['Leave Without Pay', 'LWP', 0, false, false, 0],
  ];
  for (const [name, code, days, paid, carry, maxCarry] of rows) {
    await query(
      `INSERT INTO leave_types (company_id, name, code, days_per_year, is_paid, carry_forward, max_carry_forward, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [companyId, name, code, days, paid, carry, maxCarry],
    );
  }
  return rows.length;
}

export async function seedChartOfAccountsIfEmpty(companyId: string): Promise<number> {
  const c = await query(
    `SELECT COUNT(*)::int AS n FROM accounts WHERE company_id = $1 AND is_deleted = false`,
    [companyId],
  );
  if ((c.rows[0]?.n || 0) > 0) return 0;
  const accounts: [string, string, string, string, boolean][] = [
    ['Cash', '1001', 'asset', 'cash', true],
    ['Bank', '1002', 'asset', 'bank', true],
    ['Accounts Receivable', '1100', 'asset', 'receivable', true],
    ['Inventory / Stock', '1200', 'asset', 'stock', true],
    ['Accounts Payable', '2100', 'liability', 'payable', true],
    ['CGST Payable', '2201', 'liability', 'tax', true],
    ['SGST Payable', '2202', 'liability', 'tax', true],
    ['IGST Payable', '2203', 'liability', 'tax', true],
    ['Sales', '4001', 'income', 'sales', true],
    ['Purchases', '5001', 'expense', 'purchase', true],
  ];
  for (const [name, code, type, subtype, system] of accounts) {
    await query(
      `INSERT INTO accounts (company_id, name, code, account_type, account_subtype, is_system, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [companyId, name, code, type, subtype, system],
    );
  }
  return accounts.length;
}

/** Five starter products with stock in the given godown (only if company has zero items). */
export async function seedSampleItemsIfEmpty(companyId: string, godownId: string): Promise<number> {
  const c = await query(
    `SELECT COUNT(*)::int AS n FROM items WHERE company_id = $1 AND is_deleted = false`,
    [companyId],
  );
  if ((c.rows[0]?.n || 0) > 0) return 0;

  const cat = await query(
    `INSERT INTO item_categories (company_id, name, is_active) VALUES ($1, 'General', true) RETURNING id`,
    [companyId],
  );
  const categoryId = cat.rows[0].id as string;

  const unit = await query(
    `INSERT INTO item_units (company_id, name, abbreviation, is_default) VALUES ($1, 'Pieces', 'Pcs', true) RETURNING id`,
    [companyId],
  );
  const unitId = unit.rows[0].id as string;

  const starter: { name: string; hsn: string; buy: number; sell: number; gst: number; stock: number }[] = [
    { name: 'Starter Product A', hsn: '9968', buy: 10000, sell: 11800, gst: 18, stock: 25 },
    { name: 'Starter Product B', hsn: '9968', buy: 5000, sell: 5900, gst: 18, stock: 40 },
    { name: 'Starter Product C', hsn: '0409', buy: 20000, sell: 21000, gst: 5, stock: 15 },
    { name: 'Starter Product D', hsn: '8517', buy: 50000, sell: 64900, gst: 18, stock: 5 },
    { name: 'Starter Product E', hsn: '3304', buy: 8000, sell: 9440, gst: 18, stock: 30 },
  ];

  let n = 0;
  for (const s of starter) {
    const half = Math.round((s.gst / 2) * 100) / 100;
    const ins = await query(
      `INSERT INTO items (
        company_id, name, hsn_code, category_id, unit_id, item_type, track_inventory,
        purchase_price, selling_price, tax_preference, gst_rate, cgst_rate, sgst_rate, igst_rate,
        opening_stock, opening_stock_value, is_active
      ) VALUES ($1,$2,$3,$4,$5,'product',true,$6,$7,'taxable',$8,$9,$9,0,$10,$11,true) RETURNING id`,
      [
        companyId, s.name, s.hsn, categoryId, unitId,
        s.buy, s.sell, s.gst, half,
        s.stock, s.stock * s.buy,
      ],
    );
    const itemId = ins.rows[0].id as string;
    if (s.stock > 0) {
      await query(
        `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [companyId, itemId, godownId, s.stock, s.buy],
      );
      await query(
        `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, quantity, unit_cost, balance_after, notes)
         VALUES ($1, $2, $3, 'opening_stock', $4, $5, $4, 'Opening stock (onboarding seed)')`,
        [companyId, itemId, godownId, s.stock, s.buy],
      );
    }
    n++;
  }
  return n;
}

export async function applyOnboardingSeeds(
  companyId: string,
  godownId: string,
  flags: OnboardingSeedFlags,
): Promise<{ items: number; coa: number; leaves: number }> {
  const out = { items: 0, coa: 0, leaves: 0 };
  if (flags.leaves) out.leaves = await seedLeaveTypesIfEmpty(companyId);
  if (flags.coa) out.coa = await seedChartOfAccountsIfEmpty(companyId);
  if (flags.items) out.items = await seedSampleItemsIfEmpty(companyId, godownId);
  return out;
}
