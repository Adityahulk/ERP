import { pool } from '../config/db';

type ContextType = 'sales' | 'customers' | 'stock' | 'expenses' | null;

// Simple in-memory context per company to enable contextual follow-ups
const companyContext = new Map<string, ContextType>();

export const processChatMessage = async (message: string, companyId: string) => {
  const text = message.toLowerCase();
  let currentContext = companyContext.get(companyId) || null;

  // Update context based on keywords anywhere in the sentence
  if (text.includes('sale') || text.includes('revenue') || text.includes('sold')) {
    currentContext = 'sales';
    companyContext.set(companyId, currentContext);
  } else if (text.includes('customer') || text.includes('party') || text.includes('parties') || text.includes('client')) {
    currentContext = 'customers';
    companyContext.set(companyId, currentContext);
  } else if (text.includes('stock') || text.includes('inventory') || text.includes('item') || text.includes('product')) {
    currentContext = 'stock';
    companyContext.set(companyId, currentContext);
  } else if (text.includes('expense') || text.includes('spent') || text.includes('purchase') || text.includes('bill')) {
    currentContext = 'expenses';
    companyContext.set(companyId, currentContext);
  }

  // Determine if it's a detail request vs a total/summary request
  // E.g., "what's my latest sale", "give all details", "show recent customers"
  const isDetailRequest = text.includes('detail') || text.includes('all') || text.includes('more') || text.includes('list') || text.includes('recent') || text.includes('latest');

  // Handle Detail Requests based on current context
  if (isDetailRequest && currentContext) {
    if (currentContext === 'sales') {
      const res = await pool.query(
        `SELECT invoice_number, total_amount, invoice_date, party_name_snapshot 
         FROM invoices 
         WHERE company_id = $1 AND is_deleted = false AND status != 'draft' 
         ORDER BY invoice_date DESC LIMIT 5`,
        [companyId]
      );
      if (res.rows.length === 0) return "No recent sales invoices found.";
      const details = res.rows.map(r => `• ${r.invoice_number} to ${r.party_name_snapshot || 'Unknown'} (${new Date(r.invoice_date).toLocaleDateString()}): ₹${(r.total_amount / 100).toLocaleString('en-IN')}`).join('\n');
      return `Here are your 5 most recent sales:\n${details}`;
    }
    
    if (currentContext === 'customers') {
      const res = await pool.query(
        `SELECT name, phone 
         FROM parties 
         WHERE company_id = $1 AND is_deleted = false AND party_type = 'customer' 
         ORDER BY created_at DESC LIMIT 5`,
        [companyId]
      );
      if (res.rows.length === 0) return "No recent customers found.";
      const details = res.rows.map(r => `• ${r.name} (${r.phone || 'No phone'})`).join('\n');
      return `Here are your 5 most recent customers:\n${details}`;
    }
    
    if (currentContext === 'stock') {
      const res = await pool.query(
        `SELECT name, selling_price 
         FROM items 
         WHERE company_id = $1 AND is_deleted = false 
         ORDER BY created_at DESC LIMIT 5`,
        [companyId]
      );
      if (res.rows.length === 0) return "No items found.";
      const details = res.rows.map(r => `• ${r.name}: ₹${(r.selling_price / 100).toLocaleString('en-IN')}`).join('\n');
      return `Here are your 5 most recently added items:\n${details}`;
    }

    if (currentContext === 'expenses') {
      const res = await pool.query(
        `SELECT bill_number, total_amount, bill_date 
         FROM purchase_invoices 
         WHERE company_id = $1 AND is_deleted = false AND status != 'draft' 
         ORDER BY bill_date DESC LIMIT 5`,
        [companyId]
      );
      if (res.rows.length === 0) return "No recent expense bills found.";
      const details = res.rows.map(r => `• Bill ${r.bill_number} (${new Date(r.bill_date).toLocaleDateString()}): ₹${(r.total_amount / 100).toLocaleString('en-IN')}`).join('\n');
      return `Here are your 5 most recent expenses:\n${details}`;
    }
  }

  // Handle Summary Requests
  if (currentContext === 'sales') {
    const res = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total 
       FROM invoices 
       WHERE company_id = $1 AND is_deleted = false AND status != 'draft'`,
      [companyId]
    );
    const total = res.rows[0].total / 100;
    return `Your total finalized sales amount is ₹${total.toLocaleString('en-IN')}.`;
  }

  if (currentContext === 'customers') {
    const res = await pool.query(
      `SELECT COUNT(*) as total 
       FROM parties 
       WHERE company_id = $1 AND is_deleted = false AND party_type = 'customer'`,
      [companyId]
    );
    return `You have ${res.rows[0].total} active customers.`;
  }

  if (currentContext === 'stock') {
    const countRes = await pool.query(
      `SELECT COUNT(*) as total FROM items WHERE company_id = $1 AND is_deleted = false`,
      [companyId]
    );
    
    const stockRes = await pool.query(
      `SELECT COALESCE(SUM(quantity), 0) as total_qty FROM item_stock WHERE company_id = $1`,
      [companyId]
    );

    return `You have ${countRes.rows[0].total} items in your catalog with a total stock quantity of ${stockRes.rows[0].total_qty}.`;
  }

  if (currentContext === 'expenses') {
    const res = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total 
       FROM purchase_invoices 
       WHERE company_id = $1 AND is_deleted = false AND status != 'draft'`,
      [companyId]
    );
    const total = res.rows[0].total / 100;
    return `Your total finalized purchase expenses are ₹${total.toLocaleString('en-IN')}.`;
  }

  // If no details context and no intent matched
  companyContext.delete(companyId);
  return "I am a local rule-based assistant. Try asking me about your 'sales', 'customers', 'inventory/stock', or 'purchases'.";
};
