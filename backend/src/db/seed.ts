import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://bizflow:bizflow_dev@localhost:5432/bizflow',
});

// ═══════════════════════════════════════════════════════════════
// PRE-GENERATED UUIDs (for cross-referencing)
// ═══════════════════════════════════════════════════════════════

const IDS = {
  company: uuidv4(),

  // Users
  admin: uuidv4(),
  accountant: uuidv4(),
  manager: uuidv4(),
  cashier: uuidv4(),
  staff: uuidv4(),

  // Godowns
  godownMain: uuidv4(),
  godownThane: uuidv4(),

  // Categories
  catGroceries: uuidv4(),
  catElectronics: uuidv4(),
  catClothing: uuidv4(),
  catStationery: uuidv4(),
  catHardware: uuidv4(),
  catFMCG: uuidv4(),
  catServices: uuidv4(),

  // Units
  unitPcs: uuidv4(),
  unitKg: uuidv4(),
  unitLitre: uuidv4(),
  unitMetre: uuidv4(),
  unitBox: uuidv4(),
  unitDozen: uuidv4(),
  unitSet: uuidv4(),
  unitBag: uuidv4(),
  unitBundle: uuidv4(),
  unitRoll: uuidv4(),
  unitSheet: uuidv4(),
  unitRam: uuidv4(),
  unitPack: uuidv4(),
  unitBucket: uuidv4(),
  unitHour: uuidv4(),

  // Items (20)
  itemRice: uuidv4(),
  itemDal: uuidv4(),
  itemSugar: uuidv4(),
  itemOil: uuidv4(),
  itemSalt: uuidv4(),
  itemIphone: uuidv4(),
  itemSamsung: uuidv4(),
  itemLaptop: uuidv4(),
  itemUSBC: uuidv4(),
  itemPowerbank: uuidv4(),
  itemTshirt: uuidv4(),
  itemJeans: uuidv4(),
  itemA4Paper: uuidv4(),
  itemPen: uuidv4(),
  itemCement: uuidv4(),
  itemPaint: uuidv4(),
  itemToothpaste: uuidv4(),
  itemDetergent: uuidv4(),
  itemConsultation: uuidv4(),
  itemAMC: uuidv4(),

  // Parties (10)
  partyRajesh: uuidv4(),
  partySharma: uuidv4(),
  partyPriya: uuidv4(),
  partyMumbai: uuidv4(),
  partyDigital: uuidv4(),
  partyGreen: uuidv4(),
  partyABC: uuidv4(),
  partyXYZ: uuidv4(),
  partyTechSource: uuidv4(),
  partyFarmFresh: uuidv4(),

  // Purchase orders (demo POs for GRN / list testing)
  poDemoDraft: uuidv4(),
  poDemoConfirmedMain: uuidv4(),
  poDemoConfirmedThane: uuidv4(),
  poLineDraftRice: uuidv4(),
  poLineDraftDal: uuidv4(),
  poLineUsb: uuidv4(),
  poLineOil: uuidv4(),

  // Accounts (chart of accounts)
  accCash: uuidv4(),
  accBank: uuidv4(),
  accReceivable: uuidv4(),
  accStock: uuidv4(),
  accFixedAssets: uuidv4(),
  accPayable: uuidv4(),
  accGSTPayableCGST: uuidv4(),
  accGSTPayableSGST: uuidv4(),
  accGSTPayableIGST: uuidv4(),
  accSales: uuidv4(),
  accOtherIncome: uuidv4(),
  accPurchases: uuidv4(),
  accRent: uuidv4(),
  accSalaries: uuidv4(),
  accUtilities: uuidv4(),
  accOffice: uuidv4(),

  // Leave types
  leaveCL: uuidv4(),
  leaveSL: uuidv4(),
  leaveEL: uuidv4(),
  leaveLWP: uuidv4(),
};

async function seed(): Promise<void> {
  console.log('🌱 Starting seed...\n');
  const passwordHash = await bcrypt.hash('Demo@1234', 12);

  try {
    await pool.query('BEGIN');

    // ─── 1. Company ─────────────────────────────────────────
    console.log('  📦 Creating company...');
    await pool.query(`
      INSERT INTO companies (
        id, name, legal_name, business_type, gstin, pan,
        registered_address, city, state, pincode, state_code,
        phone, email, financial_year_start,
        invoice_prefix, po_prefix, quotation_prefix,
        default_due_days, default_gst_rate,
        bank_name, bank_account_number, bank_ifsc, bank_branch, upi_id,
        terms_and_conditions, onboarding_completed, is_active
      ) VALUES (
        $1, 'BizFlow Demo — General Store', 'BizFlow Demo Private Limited',
        'Retail', '27AABCD1234E1Z5', 'AABCD1234E',
        '123 MG Road, Fort', 'Mumbai', 'Maharashtra', '400001', '27',
        '9876543210', 'admin@bizflowdemo.in', 4,
        'INV', 'PO', 'QT',
        30, 18,
        'HDFC Bank', '50100123456789', 'HDFC0001234', 'Fort, Mumbai', 'bizflowdemo@upi',
        E'1. Goods once sold will not be taken back.\n2. All disputes subject to Mumbai jurisdiction.\n3. Interest @ 2% per month on overdue payments.',
        true, true
      )
    `, [IDS.company]);

    // ─── 2. Users ───────────────────────────────────────────
    console.log('  👤 Creating users...');
    const users = [
      { id: IDS.admin, name: 'Admin User', email: 'admin@demo.com', phone: '9876543210', role: 'company_admin' },
      { id: IDS.accountant, name: 'Priya Sharma', email: 'accountant@demo.com', phone: '9876543211', role: 'accountant' },
      { id: IDS.manager, name: 'Rahul Verma', email: 'manager@demo.com', phone: '9876543212', role: 'manager' },
      { id: IDS.cashier, name: 'Anita Patel', email: 'cashier@demo.com', phone: '9876543213', role: 'cashier' },
      { id: IDS.staff, name: 'Vikram Singh', email: 'staff@demo.com', phone: '9876543214', role: 'staff' },
    ];

    for (const u of users) {
      await pool.query(`
        INSERT INTO users (id, company_id, name, email, phone, password_hash, role, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      `, [u.id, IDS.company, u.name, u.email, u.phone, passwordHash, u.role]);
    }

    // ─── 3. Godowns ─────────────────────────────────────────
    console.log('  🏭 Creating godowns...');
    await pool.query(`
      INSERT INTO godowns (id, company_id, name, code, address, city, state, pincode, phone, manager_id, is_default, is_active)
      VALUES
        ($1, $2, 'Main Store, Mumbai', 'MAIN', '123 MG Road, Fort', 'Mumbai', 'Maharashtra', '400001', '9876543210', $3, true, true),
        ($4, $2, 'Godown 1, Thane', 'THN1', '45 Station Road', 'Thane', 'Maharashtra', '400601', '9876543215', $5, false, true)
    `, [IDS.godownMain, IDS.company, IDS.admin, IDS.godownThane, IDS.manager]);

    // ─── 4. Item Categories ─────────────────────────────────
    console.log('  📂 Creating categories...');
    const categories = [
      { id: IDS.catGroceries, name: 'Groceries' },
      { id: IDS.catElectronics, name: 'Electronics' },
      { id: IDS.catClothing, name: 'Clothing' },
      { id: IDS.catStationery, name: 'Stationery' },
      { id: IDS.catHardware, name: 'Hardware' },
      { id: IDS.catFMCG, name: 'FMCG' },
      { id: IDS.catServices, name: 'Services' },
    ];

    for (const c of categories) {
      await pool.query(`
        INSERT INTO item_categories (id, company_id, name, is_active)
        VALUES ($1, $2, $3, true)
      `, [c.id, IDS.company, c.name]);
    }

    // ─── 5. Item Units ──────────────────────────────────────
    console.log('  📏 Creating units...');
    const units = [
      { id: IDS.unitPcs, name: 'Pieces', abbr: 'Pcs', def: true },
      { id: IDS.unitKg, name: 'Kilogram', abbr: 'Kg', def: false },
      { id: IDS.unitLitre, name: 'Litre', abbr: 'Ltr', def: false },
      { id: IDS.unitMetre, name: 'Metre', abbr: 'Mtr', def: false },
      { id: IDS.unitBox, name: 'Box', abbr: 'Box', def: false },
      { id: IDS.unitDozen, name: 'Dozen', abbr: 'Dzn', def: false },
      { id: IDS.unitSet, name: 'Set', abbr: 'Set', def: false },
      { id: IDS.unitBag, name: 'Bag', abbr: 'Bag', def: false },
      { id: IDS.unitBundle, name: 'Bundle', abbr: 'Bdl', def: false },
      { id: IDS.unitRoll, name: 'Roll', abbr: 'Roll', def: false },
      { id: IDS.unitSheet, name: 'Sheet', abbr: 'Sht', def: false },
      { id: IDS.unitRam, name: 'Ream', abbr: 'Ream', def: false },
      { id: IDS.unitPack, name: 'Pack', abbr: 'Pack', def: false },
      { id: IDS.unitBucket, name: 'Bucket', abbr: 'Bkt', def: false },
      { id: IDS.unitHour, name: 'Hour', abbr: 'Hr', def: false },
    ];

    for (const u of units) {
      await pool.query(`
        INSERT INTO item_units (id, company_id, name, abbreviation, is_default)
        VALUES ($1, $2, $3, $4, $5)
      `, [u.id, IDS.company, u.name, u.abbr, u.def]);
    }

    // ─── 6. Items (20 items) ────────────────────────────────
    console.log('  📦 Creating items...');
    // Helper: paise conversion
    const p = (rupees: number) => Math.round(rupees * 100);

    const items = [
      // Groceries (5% GST)
      { id: IDS.itemRice, name: 'Basmati Rice 5kg', hsn: '1006', cat: IDS.catGroceries, unit: IDS.unitBag, buy: p(350), sell: p(450), gst: 5, type: 'product', stock: 200 },
      { id: IDS.itemDal, name: 'Toor Dal 1kg', hsn: '0713', cat: IDS.catGroceries, unit: IDS.unitKg, buy: p(120), sell: p(160), gst: 5, type: 'product', stock: 300 },
      { id: IDS.itemSugar, name: 'Sugar 1kg', hsn: '1701', cat: IDS.catGroceries, unit: IDS.unitKg, buy: p(40), sell: p(52), gst: 5, type: 'product', stock: 500 },
      { id: IDS.itemOil, name: 'Sunflower Oil 1L', hsn: '1512', cat: IDS.catGroceries, unit: IDS.unitLitre, buy: p(130), sell: p(175), gst: 5, type: 'product', stock: 150 },
      { id: IDS.itemSalt, name: 'Tata Salt 1kg', hsn: '2501', cat: IDS.catGroceries, unit: IDS.unitKg, buy: p(18), sell: p(22), gst: 0, type: 'product', stock: 400 },

      // Electronics (18% GST, some serialized)
      { id: IDS.itemIphone, name: 'iPhone 15 128GB', hsn: '8517', cat: IDS.catElectronics, unit: IDS.unitPcs, buy: p(69900), sell: p(79900), gst: 18, type: 'product', stock: 8, serial: true },
      { id: IDS.itemSamsung, name: 'Samsung Galaxy S24', hsn: '8517', cat: IDS.catElectronics, unit: IDS.unitPcs, buy: p(59900), sell: p(69999), gst: 18, type: 'product', stock: 12, serial: true },
      { id: IDS.itemLaptop, name: 'HP Laptop 15s (i5, 8GB, 512GB)', hsn: '8471', cat: IDS.catElectronics, unit: IDS.unitPcs, buy: p(42000), sell: p(52999), gst: 18, type: 'product', stock: 5, serial: true },
      { id: IDS.itemUSBC, name: 'USB-C Charging Cable 1m', hsn: '8544', cat: IDS.catElectronics, unit: IDS.unitPcs, buy: p(80), sell: p(199), gst: 18, type: 'product', stock: 200 },
      { id: IDS.itemPowerbank, name: 'Power Bank 10000mAh', hsn: '8507', cat: IDS.catElectronics, unit: IDS.unitPcs, buy: p(600), sell: p(999), gst: 18, type: 'product', stock: 50 },

      // Clothing (5% / 12%)
      { id: IDS.itemTshirt, name: 'Cotton Round-Neck T-Shirt', hsn: '6109', cat: IDS.catClothing, unit: IDS.unitPcs, buy: p(180), sell: p(399), gst: 5, type: 'product', stock: 100 },
      { id: IDS.itemJeans, name: 'Denim Jeans (Slim Fit)', hsn: '6204', cat: IDS.catClothing, unit: IDS.unitPcs, buy: p(500), sell: p(1199), gst: 12, type: 'product', stock: 60 },

      // Stationery (12%)
      { id: IDS.itemA4Paper, name: 'A4 Paper Ream (500 sheets)', hsn: '4802', cat: IDS.catStationery, unit: IDS.unitRam, buy: p(220), sell: p(320), gst: 12, type: 'product', stock: 80 },
      { id: IDS.itemPen, name: 'Ball Pen Pack (10 pens)', hsn: '9608', cat: IDS.catStationery, unit: IDS.unitPack, buy: p(50), sell: p(100), gst: 12, type: 'product', stock: 150 },

      // Hardware (28%)
      { id: IDS.itemCement, name: 'UltraTech Cement 50kg', hsn: '2523', cat: IDS.catHardware, unit: IDS.unitBag, buy: p(340), sell: p(420), gst: 28, type: 'product', stock: 100 },
      { id: IDS.itemPaint, name: 'Asian Paints Emulsion 20L', hsn: '3208', cat: IDS.catHardware, unit: IDS.unitBucket, buy: p(2800), sell: p(3600), gst: 28, type: 'product', stock: 25 },

      // FMCG (18%)
      { id: IDS.itemToothpaste, name: 'Colgate MaxFresh 150g', hsn: '3306', cat: IDS.catFMCG, unit: IDS.unitPcs, buy: p(75), sell: p(110), gst: 18, type: 'product', stock: 300 },
      { id: IDS.itemDetergent, name: 'Surf Excel Quick Wash 1kg', hsn: '3402', cat: IDS.catFMCG, unit: IDS.unitKg, buy: p(120), sell: p(189), gst: 18, type: 'product', stock: 200 },

      // Services (18%)
      { id: IDS.itemConsultation, name: 'IT Consultation (per hour)', hsn: '998314', cat: IDS.catServices, unit: IDS.unitHour, buy: 0, sell: p(2500), gst: 18, type: 'service', stock: 0, noInventory: true },
      { id: IDS.itemAMC, name: 'Annual Maintenance Contract', hsn: '998715', cat: IDS.catServices, unit: IDS.unitPcs, buy: 0, sell: p(15000), gst: 18, type: 'service', stock: 0, noInventory: true },
    ];

    for (const item of items) {
      // numeric(5,2) for split rates — avoid reusing one placeholder for int + numeric (PG error 42P08)
      const halfGst = Math.round((item.gst / 2) * 100) / 100;
      await pool.query(`
        INSERT INTO items (
          id, company_id, name, hsn_code, category_id, unit_id,
          item_type, track_inventory, is_serialized,
          purchase_price, selling_price,
          tax_preference, gst_rate, cgst_rate, sgst_rate, igst_rate,
          opening_stock, opening_stock_value, is_active
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9,
          $10, $11,
          'taxable', $12, $13, $13, 0,
          $14, $15, true
        )
      `, [
        item.id, IDS.company, item.name, item.hsn, item.cat, item.unit,
        item.type, !(item as any).noInventory, !!(item as any).serial,
        item.buy, item.sell,
        item.gst, halfGst,
        item.stock, item.stock * item.buy,
      ]);

      // Create item_stock entries for items that track inventory
      if (!(item as any).noInventory && item.stock > 0) {
        await pool.query(`
          INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
          VALUES ($1, $2, $3, $4, $5)
        `, [IDS.company, item.id, IDS.godownMain, item.stock, item.buy]);
      }
    }

    // ─── 7. Parties (10) ────────────────────────────────────
    console.log('  👥 Creating parties...');
    const parties = [
      // Customers (6)
      { id: IDS.partyRajesh, type: 'customer', name: 'Rajesh Electronics', gstin: '27AABCR1234E1Z5', phone: '9821234501', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', stateCode: '27', credit: p(100000) },
      { id: IDS.partySharma, type: 'customer', name: 'Sharma General Store', gstin: '27AABCS5678E1Z3', phone: '9821234502', city: 'Pune', state: 'Maharashtra', pincode: '411001', stateCode: '27', credit: p(50000) },
      { id: IDS.partyPriya, type: 'customer', name: 'Priya Fashion House', gstin: '27AABCP9012E1Z1', phone: '9821234503', city: 'Mumbai', state: 'Maharashtra', pincode: '400050', stateCode: '27', credit: p(75000) },
      { id: IDS.partyMumbai, type: 'customer', name: 'Mumbai Traders', gstin: '27AABCM3456E1Z9', phone: '9821234504', city: 'Mumbai', state: 'Maharashtra', pincode: '400003', stateCode: '27', credit: p(200000) },
      { id: IDS.partyDigital, type: 'customer', name: 'Digital Hub', phone: '9821234505', city: 'Thane', state: 'Maharashtra', pincode: '400601', stateCode: '27', credit: p(25000) },
      { id: IDS.partyGreen, type: 'customer', name: 'Green Mart', phone: '9821234506', city: 'Navi Mumbai', state: 'Maharashtra', pincode: '400703', stateCode: '27', credit: p(30000) },

      // Suppliers (4)
      { id: IDS.partyABC, type: 'supplier', name: 'ABC Distributors Pvt Ltd', gstin: '27AABCA1234E1Z5', phone: '9821234601', city: 'Mumbai', state: 'Maharashtra', pincode: '400002', stateCode: '27', credit: 0 },
      { id: IDS.partyXYZ, type: 'supplier', name: 'XYZ Wholesale', gstin: '27AABCX5678E1Z3', phone: '9821234602', city: 'Nagpur', state: 'Maharashtra', pincode: '440001', stateCode: '27', credit: 0 },
      { id: IDS.partyTechSource, type: 'supplier', name: 'Tech Source India Pvt Ltd', gstin: '29AABCT9012E1Z1', phone: '9821234603', city: 'Bangalore', state: 'Karnataka', pincode: '560001', stateCode: '29', credit: 0 },
      { id: IDS.partyFarmFresh, type: 'supplier', name: 'Farm Fresh Supplies', gstin: '27AABCF3456E1Z9', phone: '9821234604', city: 'Nashik', state: 'Maharashtra', pincode: '422001', stateCode: '27', credit: 0 },
    ];

    for (const party of parties) {
      await pool.query(`
        INSERT INTO parties (
          id, company_id, party_type, name, display_name, gstin, phone,
          billing_city, billing_state, billing_pincode, billing_state_code,
          credit_limit, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
      `, [
        party.id, IDS.company, party.type, party.name, party.name,
        (party as any).gstin || null, party.phone,
        party.city, party.state, party.pincode, party.stateCode,
        party.credit,
      ]);
    }

    const now = new Date();
    const daysAgo = (d: number) => {
      const date = new Date(now);
      date.setDate(date.getDate() - d);
      return date.toISOString().split('T')[0];
    };

    // ─── 7b. Purchase orders (draft + confirmed for GRN testing) ─
    console.log('  📝 Creating purchase orders...');
    const halfRate = (g: number) => Math.round((g / 2) * 100) / 100;

    // DEMO-PO-001 — draft, Farm Fresh, Main godown (edit / confirm / receive flow)
    const po1Lines = [
      { id: IDS.poLineDraftRice, item: IDS.itemRice, name: 'Basmati Rice 5kg', hsn: '1006', unit: 'Bag', qty: 100, price: p(350), gst: 5 },
      { id: IDS.poLineDraftDal, item: IDS.itemDal, name: 'Toor Dal 1kg', hsn: '0713', unit: 'Kg', qty: 50, price: p(120), gst: 5 },
    ];
    let po1Sub = 0, po1Cgst = 0, po1Sgst = 0;
    for (const ln of po1Lines) {
      const tax = Math.round(ln.qty * ln.price * ln.gst / 100);
      po1Sub += ln.qty * ln.price;
      po1Cgst += Math.round(tax / 2);
      po1Sgst += tax - Math.round(tax / 2);
    }
    const po1Total = po1Sub + po1Cgst + po1Sgst;
    await pool.query(`
      INSERT INTO purchase_orders (
        id, company_id, godown_id, po_number, po_date, expected_date, party_id, party_name_snapshot,
        subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
        status, notes, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$9,$10,$11,0,$12,'draft',$13,$14)
    `, [
      IDS.poDemoDraft, IDS.company, IDS.godownMain, 'DEMO-PO-001', daysAgo(12), daysAgo(-3),
      IDS.partyFarmFresh, 'Farm Fresh Supplies',
      po1Sub, po1Cgst, po1Sgst, po1Total,
      'Stock replenishment — groceries', IDS.admin,
    ]);
    for (const ln of po1Lines) {
      const tax = Math.round(ln.qty * ln.price * ln.gst / 100);
      const cg = Math.round(tax / 2);
      const sg = tax - cg;
      const tot = ln.qty * ln.price + tax;
      const hr = halfRate(ln.gst);
      await pool.query(`
        INSERT INTO purchase_order_items (
          id, po_id, item_id, item_name, hsn_code, unit, quantity_ordered, quantity_received,
          unit_price, discount_amount, gst_rate, cgst_rate, sgst_rate, igst_rate,
          cgst_amount, sgst_amount, igst_amount, total_amount
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,0,$16)
      `, [
        ln.id, IDS.poDemoDraft, ln.item, ln.name, ln.hsn, ln.unit, ln.qty, 0,
        ln.price, 0, ln.gst, hr, hr, cg, sg, tot,
      ]);
    }

    // DEMO-PO-002 — confirmed, ABC, Main (ready for Receive Stock / GRN)
    const tax2 = Math.round(300 * p(80) * 18 / 100);
    const cg2 = Math.round(tax2 / 2);
    const sg2 = tax2 - cg2;
    const sub2 = 300 * p(80);
    const tot2 = sub2 + tax2;
    await pool.query(`
      INSERT INTO purchase_orders (
        id, company_id, godown_id, po_number, po_date, expected_date, party_id, party_name_snapshot,
        subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
        status, notes, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$9,$10,$11,0,$12,'confirmed',$13,$14)
    `, [
      IDS.poDemoConfirmedMain, IDS.company, IDS.godownMain, 'DEMO-PO-002', daysAgo(8), daysAgo(5),
      IDS.partyABC, 'ABC Distributors Pvt Ltd',
      sub2, cg2, sg2, tot2,
      'Cables restock', IDS.admin,
    ]);
    const hr18 = halfRate(18);
    await pool.query(`
      INSERT INTO purchase_order_items (
        id, po_id, item_id, item_name, hsn_code, unit, quantity_ordered, quantity_received,
        unit_price, discount_amount, gst_rate, cgst_rate, sgst_rate, igst_rate,
        cgst_amount, sgst_amount, igst_amount, total_amount
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,0,$16)
    `, [
      IDS.poLineUsb, IDS.poDemoConfirmedMain, IDS.itemUSBC, 'USB-C Charging Cable 1m', '8544', 'Pcs', 300, 0,
      p(80), 0, 18, hr18, hr18, cg2, sg2, tot2,
    ]);

    // DEMO-PO-003 — confirmed, XYZ, Thane godown (multi-location receive)
    const tax3 = Math.round(40 * p(130) * 5 / 100);
    const cg3 = Math.round(tax3 / 2);
    const sg3 = tax3 - cg3;
    const sub3 = 40 * p(130);
    const tot3 = sub3 + tax3;
    await pool.query(`
      INSERT INTO purchase_orders (
        id, company_id, godown_id, po_number, po_date, expected_date, party_id, party_name_snapshot,
        subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
        status, notes, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$9,$10,$11,0,$12,'confirmed',$13,$14)
    `, [
      IDS.poDemoConfirmedThane, IDS.company, IDS.godownThane, 'DEMO-PO-003', daysAgo(5), daysAgo(10),
      IDS.partyXYZ, 'XYZ Wholesale',
      sub3, cg3, sg3, tot3,
      'Oil delivery to Thane warehouse', IDS.admin,
    ]);
    const hr5 = halfRate(5);
    await pool.query(`
      INSERT INTO purchase_order_items (
        id, po_id, item_id, item_name, hsn_code, unit, quantity_ordered, quantity_received,
        unit_price, discount_amount, gst_rate, cgst_rate, sgst_rate, igst_rate,
        cgst_amount, sgst_amount, igst_amount, total_amount
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,0,$16)
    `, [
      IDS.poLineOil, IDS.poDemoConfirmedThane, IDS.itemOil, 'Sunflower Oil 1L', '1512', 'Ltr', 40, 0,
      p(130), 0, 5, hr5, hr5, cg3, sg3, tot3,
    ]);

    // ─── 8. Invoices (15 over last 90 days) ─────────────────
    console.log('  🧾 Creating invoices...');
    const invoiceData = [
      { num: 'INV-2025-001', date: daysAgo(85), due: daysAgo(55), party: IDS.partyRajesh, items: [{ item: IDS.itemIphone, qty: 2, price: p(79900) }], paid: p(159800), status: 'paid' },
      { num: 'INV-2025-002', date: daysAgo(78), due: daysAgo(48), party: IDS.partySharma, items: [{ item: IDS.itemRice, qty: 10, price: p(450) }, { item: IDS.itemDal, qty: 20, price: p(160) }], paid: p(5050), status: 'partial' },
      { num: 'INV-2025-003', date: daysAgo(72), due: daysAgo(42), party: IDS.partyPriya, items: [{ item: IDS.itemTshirt, qty: 50, price: p(399) }, { item: IDS.itemJeans, qty: 20, price: p(1199) }], paid: p(43930), status: 'paid' },
      { num: 'INV-2025-004', date: daysAgo(65), due: daysAgo(35), party: IDS.partyMumbai, items: [{ item: IDS.itemCement, qty: 100, price: p(420) }, { item: IDS.itemPaint, qty: 10, price: p(3600) }], paid: 0, status: 'overdue' },
      { num: 'INV-2025-005', date: daysAgo(55), due: daysAgo(25), party: IDS.partyDigital, items: [{ item: IDS.itemLaptop, qty: 3, price: p(52999) }], paid: p(100000), status: 'partial' },
      { num: 'INV-2025-006', date: daysAgo(48), due: daysAgo(18), party: IDS.partyGreen, items: [{ item: IDS.itemToothpaste, qty: 100, price: p(110) }, { item: IDS.itemDetergent, qty: 50, price: p(189) }], paid: p(20450), status: 'paid' },
      { num: 'INV-2025-007', date: daysAgo(40), due: daysAgo(10), party: IDS.partyRajesh, items: [{ item: IDS.itemSamsung, qty: 5, price: p(69999) }], paid: 0, status: 'overdue' },
      { num: 'INV-2025-008', date: daysAgo(35), due: daysAgo(5), party: IDS.partySharma, items: [{ item: IDS.itemSugar, qty: 100, price: p(52) }, { item: IDS.itemOil, qty: 50, price: p(175) }], paid: p(14200), status: 'paid' },
      { num: 'INV-2025-009', date: daysAgo(28), due: daysAgo(-2), party: IDS.partyMumbai, items: [{ item: IDS.itemA4Paper, qty: 30, price: p(320) }, { item: IDS.itemPen, qty: 50, price: p(100) }], paid: 0, status: 'unpaid' },
      { num: 'INV-2025-010', date: daysAgo(20), due: daysAgo(-10), party: IDS.partyPriya, items: [{ item: IDS.itemJeans, qty: 30, price: p(1199) }], paid: p(20000), status: 'partial' },
      { num: 'INV-2025-011', date: daysAgo(15), due: daysAgo(-15), party: IDS.partyDigital, items: [{ item: IDS.itemPowerbank, qty: 20, price: p(999) }, { item: IDS.itemUSBC, qty: 100, price: p(199) }], paid: 0, status: 'unpaid' },
      { num: 'INV-2025-012', date: daysAgo(10), due: daysAgo(-20), party: IDS.partyGreen, items: [{ item: IDS.itemSalt, qty: 200, price: p(22) }], paid: p(4400), status: 'paid' },
      { num: 'INV-2025-013', date: daysAgo(7), due: daysAgo(-23), party: IDS.partyRajesh, items: [{ item: IDS.itemConsultation, qty: 8, price: p(2500) }], paid: 0, status: 'unpaid' },
      { num: 'INV-2025-014', date: daysAgo(3), due: daysAgo(-27), party: IDS.partyMumbai, items: [{ item: IDS.itemCement, qty: 50, price: p(420) }, { item: IDS.itemSalt, qty: 100, price: p(22) }], paid: 0, status: 'unpaid' },
      { num: 'INV-2025-015', date: daysAgo(1), due: daysAgo(-29), party: IDS.partySharma, items: [{ item: IDS.itemAMC, qty: 1, price: p(15000) }], paid: p(17700), status: 'paid' },
    ];

    for (const inv of invoiceData) {
      const invId = uuidv4();
      // Calculate totals
      let subtotal = 0;
      const lineItems: Array<{item: string; qty: number; price: number; gstRate: number}> = [];

      for (const li of inv.items) {
        const itemRow = items.find(i => i.id === li.item)!;
        const lineTotal = li.qty * li.price;
        subtotal += lineTotal;
        lineItems.push({ ...li, gstRate: itemRow.gst });
      }

      const taxable = subtotal;
      let cgst = 0, sgst = 0;
      for (const li of lineItems) {
        const lineTotal = li.qty * li.price;
        const lineTax = Math.round(lineTotal * li.gstRate / 100);
        cgst += Math.round(lineTax / 2);
        sgst += Math.round(lineTax / 2);
      }
      const total = taxable + cgst + sgst;
      const paymentStatus = inv.paid >= total ? 'paid' : inv.paid > 0 ? 'partial' : (new Date(inv.due) < now ? 'overdue' : 'unpaid');

      await pool.query(`
        INSERT INTO invoices (
          id, company_id, godown_id, invoice_type, invoice_number, invoice_date, due_date,
          party_id, place_of_supply, is_interstate,
          subtotal, taxable_amount, cgst_amount, sgst_amount,
          total_amount, paid_amount, payment_status, status,
          created_by
        ) VALUES (
          $1, $2, $3, 'tax_invoice', $4, $5, $6,
          $7, '27', false,
          $8, $9, $10, $11,
          $12, $13, $14, 'confirmed',
          $15
        )
      `, [
        invId, IDS.company, IDS.godownMain, inv.num, inv.date, inv.due,
        inv.party,
        subtotal, taxable, cgst, sgst,
        total, inv.paid, paymentStatus,
        IDS.admin,
      ]);

      // Insert invoice items
      let sortOrder = 0;
      for (const li of inv.items) {
        const itemRow = items.find(i => i.id === li.item)!;
        const lineTotal = li.qty * li.price;
        const lineTax = Math.round(lineTotal * itemRow.gst / 100);
        const lineCGST = Math.round(lineTax / 2);
        const lineSGST = Math.round(lineTax / 2);

        await pool.query(`
          INSERT INTO invoice_items (
            invoice_id, company_id, item_id, item_name, hsn_code, unit,
            quantity, unit_price, taxable_amount,
            gst_rate, cgst_rate, sgst_rate,
            cgst_amount, sgst_amount, total_amount, sort_order
          ) VALUES (
            $1, $2, $3, $4, $5, 'Pcs',
            $6, $7, $8,
            $9, $10, $10,
            $11, $12, $13, $14
          )
        `, [
          invId, IDS.company, li.item, itemRow.name, itemRow.hsn,
          li.qty, li.price, lineTotal,
          itemRow.gst, itemRow.gst / 2,
          lineCGST, lineSGST, lineTotal + lineCGST + lineSGST, sortOrder++,
        ]);
      }
    }

    // ─── 9. Purchase Invoices (8 over last 90 days) ─────────
    console.log('  📥 Creating purchase invoices...');
    const purchaseData = [
      { num: 'BILL-001', date: daysAgo(80), party: IDS.partyABC, items: [{ item: IDS.itemRice, qty: 100, price: p(350) }, { item: IDS.itemDal, qty: 100, price: p(120) }], paid: p(49350), status: 'paid' },
      { num: 'BILL-002', date: daysAgo(70), party: IDS.partyTechSource, items: [{ item: IDS.itemIphone, qty: 10, price: p(69900) }], paid: 0, status: 'unpaid' },
      { num: 'BILL-003', date: daysAgo(60), party: IDS.partyXYZ, items: [{ item: IDS.itemCement, qty: 200, price: p(340) }], paid: p(87040), status: 'paid' },
      { num: 'BILL-004', date: daysAgo(50), party: IDS.partyFarmFresh, items: [{ item: IDS.itemSugar, qty: 500, price: p(40) }, { item: IDS.itemOil, qty: 200, price: p(130) }], paid: p(20000), status: 'partial' },
      { num: 'BILL-005', date: daysAgo(40), party: IDS.partyABC, items: [{ item: IDS.itemToothpaste, qty: 300, price: p(75) }, { item: IDS.itemDetergent, qty: 200, price: p(120) }], paid: 0, status: 'unpaid' },
      { num: 'BILL-006', date: daysAgo(30), party: IDS.partyTechSource, items: [{ item: IDS.itemSamsung, qty: 15, price: p(59900) }], paid: p(1060530), status: 'paid' },
      { num: 'BILL-007', date: daysAgo(15), party: IDS.partyXYZ, items: [{ item: IDS.itemPaint, qty: 30, price: p(2800) }], paid: 0, status: 'unpaid' },
      { num: 'BILL-008', date: daysAgo(5), party: IDS.partyFarmFresh, items: [{ item: IDS.itemSalt, qty: 500, price: p(18) }], paid: 0, status: 'unpaid' },
    ];

    for (const pi of purchaseData) {
      const piId = uuidv4();
      let subtotal = 0;
      const lineItems: Array<{item: string; qty: number; price: number; gstRate: number}> = [];

      for (const li of pi.items) {
        const itemRow = items.find(i => i.id === li.item)!;
        subtotal += li.qty * li.price;
        lineItems.push({ ...li, gstRate: itemRow.gst });
      }

      const taxable = subtotal;
      let cgst = 0, sgst = 0;
      for (const li of lineItems) {
        const lineTotal = li.qty * li.price;
        const lineTax = Math.round(lineTotal * li.gstRate / 100);
        cgst += Math.round(lineTax / 2);
        sgst += Math.round(lineTax / 2);
      }
      const total = taxable + cgst + sgst;
      const payStatus = pi.paid >= total ? 'paid' : pi.paid > 0 ? 'partial' : 'unpaid';

      await pool.query(`
        INSERT INTO purchase_invoices (
          id, company_id, godown_id, bill_number, bill_date, party_id,
          subtotal, taxable_amount, cgst_amount, sgst_amount,
          total_amount, paid_amount, payment_status, status,
          created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, 'confirmed',
          $14
        )
      `, [
        piId, IDS.company, IDS.godownMain, pi.num, pi.date, pi.party,
        subtotal, taxable, cgst, sgst,
        total, pi.paid, payStatus,
        IDS.admin,
      ]);

      // Insert line items
      for (const li of pi.items) {
        const itemRow = items.find(i => i.id === li.item)!;
        const lineTotal = li.qty * li.price;
        const lineTax = Math.round(lineTotal * itemRow.gst / 100);
        const lineCGST = Math.round(lineTax / 2);
        const lineSGST = Math.round(lineTax / 2);

        await pool.query(`
          INSERT INTO purchase_invoice_items (
            purchase_invoice_id, item_id, item_name, hsn_code, unit,
            quantity, unit_price, gst_rate, cgst_rate, sgst_rate,
            cgst_amount, sgst_amount, total_amount
          ) VALUES (
            $1, $2, $3, $4, 'Pcs',
            $5, $6, $7, $8, $8,
            $9, $10, $11
          )
        `, [
          piId, li.item, itemRow.name, itemRow.hsn,
          li.qty, li.price, itemRow.gst, itemRow.gst / 2,
          lineCGST, lineSGST, lineTotal + lineCGST + lineSGST,
        ]);
      }
    }

    // ─── 10. Chart of Accounts ──────────────────────────────
    console.log('  📊 Creating chart of accounts...');
    const accounts = [
      // Assets
      { id: IDS.accCash, name: 'Cash', code: '1001', type: 'asset', subtype: 'cash', system: true },
      { id: IDS.accBank, name: 'HDFC Bank', code: '1002', type: 'asset', subtype: 'bank', system: true },
      { id: IDS.accReceivable, name: 'Accounts Receivable', code: '1100', type: 'asset', subtype: 'receivable', system: true },
      { id: IDS.accStock, name: 'Inventory / Stock', code: '1200', type: 'asset', subtype: 'stock', system: true },
      { id: IDS.accFixedAssets, name: 'Fixed Assets', code: '1300', type: 'asset', subtype: 'fixed_asset', system: true },

      // Liabilities
      { id: IDS.accPayable, name: 'Accounts Payable', code: '2100', type: 'liability', subtype: 'payable', system: true },
      { id: IDS.accGSTPayableCGST, name: 'CGST Payable', code: '2201', type: 'liability', subtype: 'tax', system: true },
      { id: IDS.accGSTPayableSGST, name: 'SGST Payable', code: '2202', type: 'liability', subtype: 'tax', system: true },
      { id: IDS.accGSTPayableIGST, name: 'IGST Payable', code: '2203', type: 'liability', subtype: 'tax', system: true },

      // Income
      { id: IDS.accSales, name: 'Sales', code: '4001', type: 'income', subtype: 'sales', system: true },
      { id: IDS.accOtherIncome, name: 'Other Income', code: '4100', type: 'income', subtype: 'other_expense', system: false },

      // Expenses
      { id: IDS.accPurchases, name: 'Purchases', code: '5001', type: 'expense', subtype: 'purchase', system: true },
      { id: IDS.accRent, name: 'Rent', code: '5100', type: 'expense', subtype: 'rent', system: false },
      { id: IDS.accSalaries, name: 'Salaries & Wages', code: '5200', type: 'expense', subtype: 'salary', system: false },
      { id: IDS.accUtilities, name: 'Utilities (Electricity, Water)', code: '5300', type: 'expense', subtype: 'utilities', system: false },
      { id: IDS.accOffice, name: 'Office Expenses', code: '5400', type: 'expense', subtype: 'other_expense', system: false },
    ];

    for (const acc of accounts) {
      await pool.query(`
        INSERT INTO accounts (
          id, company_id, name, code, account_type, account_subtype, is_system, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      `, [acc.id, IDS.company, acc.name, acc.code, acc.type, acc.subtype, acc.system]);
    }

    // ─── 11. Leave Types ────────────────────────────────────
    console.log('  🏖️  Creating leave types...');
    const leaveTypes = [
      { id: IDS.leaveCL, name: 'Casual Leave', code: 'CL', days: 12, paid: true, carry: false },
      { id: IDS.leaveSL, name: 'Sick Leave', code: 'SL', days: 6, paid: true, carry: false },
      { id: IDS.leaveEL, name: 'Earned Leave', code: 'EL', days: 15, paid: true, carry: true, maxCarry: 30 },
      { id: IDS.leaveLWP, name: 'Leave Without Pay', code: 'LWP', days: 0, paid: false, carry: false },
    ];

    for (const lt of leaveTypes) {
      await pool.query(`
        INSERT INTO leave_types (
          id, company_id, name, code, days_per_year, is_paid, carry_forward, max_carry_forward, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
      `, [lt.id, IDS.company, lt.name, lt.code, lt.days, lt.paid, lt.carry, (lt as any).maxCarry || 0]);
    }

    // ─── 12. Employee Profiles ──────────────────────────────
    console.log('  👷 Creating employee profiles...');
    const employees = [
      { userId: IDS.manager, code: 'EMP001', designation: 'Store Manager', dept: 'Operations', godown: IDS.godownMain, join: daysAgo(365), salary: p(600000) },
      { userId: IDS.cashier, code: 'EMP002', designation: 'Cashier', dept: 'Sales', godown: IDS.godownMain, join: daysAgo(300), salary: p(300000) },
      { userId: IDS.staff, code: 'EMP003', designation: 'Sales Associate', dept: 'Sales', godown: IDS.godownThane, join: daysAgo(180), salary: p(240000) },
    ];

    for (const emp of employees) {
      await pool.query(`
        INSERT INTO employee_profiles (
          company_id, user_id, employee_code, designation, department,
          godown_id, joining_date, employment_type, annual_salary, salary_type,
          is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'full_time', $8, 'monthly', true)
      `, [IDS.company, emp.userId, emp.code, emp.designation, emp.dept, emp.godown, emp.join, emp.salary]);
    }

    // ─── 13. Attendance (last 30 days for 3 employees) ──────
    console.log('  ⏰ Creating attendance records...');
    const employeeUserIds = [IDS.manager, IDS.cashier, IDS.staff];

    for (let day = 1; day <= 30; day++) {
      const dateStr = daysAgo(day);
      const dateObj = new Date(dateStr);
      const dayOfWeek = dateObj.getDay(); // 0 = Sunday

      // Skip Sundays
      if (dayOfWeek === 0) continue;

      for (const userId of employeeUserIds) {
        // Random: 90% present, 5% absent, 5% half-day
        const rand = Math.random();
        let status = 'present';
        let clockIn: string | null = null;
        let clockOut: string | null = null;

        if (rand > 0.95) {
          status = 'absent';
        } else if (rand > 0.90) {
          status = 'half_day';
          clockIn = `${dateStr}T09:30:00+05:30`;
          clockOut = `${dateStr}T13:30:00+05:30`;
        } else {
          status = 'present';
          // Random clock-in between 9:00 and 9:45
          const mins = Math.floor(Math.random() * 45);
          clockIn = `${dateStr}T09:${mins.toString().padStart(2, '0')}:00+05:30`;
          // Random clock-out between 17:30 and 18:30
          const outMins = 30 + Math.floor(Math.random() * 60);
          const outHour = 17 + Math.floor(outMins / 60);
          const outMin = outMins % 60;
          clockOut = `${dateStr}T${outHour}:${outMin.toString().padStart(2, '0')}:00+05:30`;
        }

        const godown = userId === IDS.staff ? IDS.godownThane : IDS.godownMain;

        await pool.query(`
          INSERT INTO attendance (company_id, godown_id, user_id, date, clock_in, clock_out, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (user_id, date) DO NOTHING
        `, [IDS.company, godown, userId, dateStr, clockIn, clockOut, status]);
      }
    }

    await pool.query('COMMIT');
    console.log('\n🎉 Seed complete! All demo data created successfully.');
    console.log('\n📋 Login credentials:');
    console.log('   admin@demo.com      / Demo@1234  (company_admin)');
    console.log('   accountant@demo.com / Demo@1234  (accountant)');
    console.log('   manager@demo.com    / Demo@1234  (manager)');
    console.log('   cashier@demo.com    / Demo@1234  (cashier)');
    console.log('   staff@demo.com      / Demo@1234  (staff)');
    console.log('\n📦 Purchase orders (Purchases → Purchase Orders):');
    console.log('   DEMO-PO-001  draft      — Farm Fresh, rice + dal (confirm then GRN)');
    console.log('   DEMO-PO-002  confirmed  — ABC Distributors, USB cables (use Receive Stock)');
    console.log('   DEMO-PO-003  confirmed  — XYZ Wholesale, oil → Thane godown (GRN)');
    console.log('   Suppliers: ABC Distributors, XYZ Wholesale, Tech Source India, Farm Fresh Supplies');

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
