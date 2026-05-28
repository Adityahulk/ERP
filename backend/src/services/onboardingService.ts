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

export async function seedDefaultItemMasters(companyId: string): Promise<{ units: number; categories: number; conversions: number }> {
  const units: Array<[string, string, boolean]> = [
    ['Bags', 'Bag', false],
    ['Bottles', 'Btl', false],
    ['Box', 'Box', false],
    ['Bundles', 'Bdl', false],
    ['Cans', 'Can', false],
    ['Cartons', 'Ctn', false],
    ['Dozens', 'Dzn', false],
    ['Grammes', 'Gm', false],
    ['Kilograms', 'Kg', false],
    ['Litre', 'Ltr', false],
    ['Meters', 'Mtr', false],
    ['Centimeters', 'Cm', false],
    ['Millilitre', 'Ml', false],
    ['Numbers', 'Nos', false],
    ['Packs', 'Pac', false],
    ['Pairs', 'Prs', false],
    ['Pieces', 'Pcs', true],
    ['Rolls', 'Rol', false],
    ['Sets', 'Set', false],
    ['Tonnes', 'Ton', false],
  ];
  const categories: Array<[string, string]> = [
    ['General', 'Default item category'],
    ['Grocery', 'Food, grains and daily-use goods'],
    ['Electronics', 'Electronic items and accessories'],
    ['Clothing', 'Garments, textiles and apparel'],
    ['Raw Materials', 'Materials used for manufacturing or job work'],
    ['Finished Goods', 'Ready-to-sell products'],
    ['Trading Goods', 'Goods bought and sold without further processing'],
    ['Services', 'Service and labour line items'],
    ['Consumables', 'Consumable supplies used in operations'],
    ['Packaging', 'Packing and shipping material'],
    ['Spare Parts', 'Replacement and maintenance parts'],
    ['Office Supplies', 'Office and administrative supplies'],
  ];

  let insertedUnits = 0;
  for (const [name, abbreviation, isDefault] of units) {
    const existing = await query(
      `SELECT id FROM item_units
       WHERE company_id = $1
         AND (LOWER(TRIM(name)) = LOWER(TRIM($2))
           OR LOWER(TRIM(COALESCE(abbreviation, ''))) = LOWER(TRIM($3)))
       LIMIT 1`,
      [companyId, name, abbreviation],
    );
    if (existing.rows.length) continue;
    if (isDefault) await query('UPDATE item_units SET is_default = false WHERE company_id = $1', [companyId]);
    await query(
      `INSERT INTO item_units (company_id, name, abbreviation, is_default) VALUES ($1, $2, $3, $4)`,
      [companyId, name, abbreviation, isDefault],
    );
    insertedUnits++;
  }

  let insertedCategories = 0;
  for (const [name, description] of categories) {
    const existing = await query(
      `SELECT id FROM item_categories
       WHERE company_id = $1 AND COALESCE(is_deleted, false) = false
         AND LOWER(TRIM(name)) = LOWER(TRIM($2))
       LIMIT 1`,
      [companyId, name],
    );
    if (existing.rows.length) continue;
    await query(
      `INSERT INTO item_categories (company_id, name, description, is_active, is_deleted)
       VALUES ($1, $2, $3, true, false)`,
      [companyId, name, description],
    );
    insertedCategories++;
  }

  const conversionDefs: Array<[string, number, string]> = [
    ['Kg', 1000, 'Gm'],
    ['Ltr', 1000, 'Ml'],
    ['Mtr', 100, 'Cm'],
    ['Dzn', 12, 'Pcs'],
    ['Ton', 1000, 'Kg'],
  ];
  let insertedConversions = 0;
  for (const [baseAbbr, factor, secondaryAbbr] of conversionDefs) {
    const pair = await query(
      `SELECT bu.id AS base_unit_id, su.id AS secondary_unit_id
       FROM item_units bu
       JOIN item_units su ON su.company_id = bu.company_id
       WHERE bu.company_id = $1
         AND LOWER(TRIM(COALESCE(bu.abbreviation, ''))) = LOWER($2)
         AND LOWER(TRIM(COALESCE(su.abbreviation, ''))) = LOWER($3)
       LIMIT 1`,
      [companyId, baseAbbr, secondaryAbbr],
    );
    if (!pair.rows.length) continue;
    const inserted = await query(
      `INSERT INTO item_unit_conversions (company_id, base_unit_id, factor, secondary_unit_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, base_unit_id, secondary_unit_id) DO NOTHING
       RETURNING id`,
      [companyId, pair.rows[0].base_unit_id, factor, pair.rows[0].secondary_unit_id],
    );
    insertedConversions += inserted.rows.length;
  }

  return { units: insertedUnits, categories: insertedCategories, conversions: insertedConversions };
}

/** Five starter products with stock in the given godown (only if company has zero items). */
export async function seedSampleItemsIfEmpty(companyId: string, godownId: string): Promise<number> {
  const c = await query(
    `SELECT COUNT(*)::int AS n FROM items WHERE company_id = $1 AND is_deleted = false`,
    [companyId],
  );
  if ((c.rows[0]?.n || 0) > 0) return 0;

  await seedDefaultItemMasters(companyId);
  const cat = await query(
    `SELECT id FROM item_categories WHERE company_id = $1 AND is_deleted = false ORDER BY CASE WHEN name = 'General' THEN 0 ELSE 1 END, name LIMIT 1`,
    [companyId],
  );
  const categoryId = cat.rows[0].id as string;

  const unit = await query(
    `SELECT id FROM item_units WHERE company_id = $1 ORDER BY is_default DESC, CASE WHEN abbreviation = 'Pcs' THEN 0 ELSE 1 END, name LIMIT 1`,
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
