import { query } from '../config/db';
import { getActiveProvider } from './whatsapp/providerManager';

// Built-in basic templates matching the specification
const TEMPLATES: Record<string, string> = {
  INVOICE_SHARE: "Dear {party_name},\n\nYour invoice from {company_name}:\nInvoice No: {invoice_number}\nDate: {date}\nAmount: ₹{amount}\n\nView & Download: {link}\n\nFor queries: {phone}\n— {company_name}",
  PAYMENT_REMINDER: "Dear {party_name},\n\nThis is a reminder for pending payment:\nInvoice: {invoice_number} dated {date}\nDue: {due_date}\nAmount Due: ₹{amount}\n\nPlease make the payment at your earliest.\n📞 {phone}\n— {company_name}",
  PAYMENT_RECEIPT: "Dear {party_name},\n\nWe have received your payment.\nReceipt No: {payment_number}\nDate: {date}\nAmount: ₹{amount}\nMode: {payment_mode}\n\nThank you for your business.\n— {company_name}",
  LOW_STOCK_ALERT: "📦 Low Stock Alert — {company_name}\n{item_name} ({sku}) is running low.\nCurrent Stock: {quantity} {unit}\nReorder Level: {reorder_point}\nPlease reorder from your supplier.",
  CAMPAIGN_BROADCAST: "{message}",
  SERVICE_REMINDER: "{message}",
};

/**
 * Replaces `{key}` blocks with values from the given record.
 */
function compileTemplate(template: string, variables: Record<string, any>) {
   return template.replace(/{(\w+)}/g, (_, k) => variables[k] !== undefined ? variables[k] : `{${k}}`);
}

export async function sendWhatsApp(phone: string, template_type: string, variables: Record<string, any>, companyId: string) {
   const customTemplate = await query(
     `SELECT content FROM message_templates WHERE company_id = $1 AND channel = 'whatsapp' AND template_type = $2 AND is_active = true`,
     [companyId, template_type],
   ).then((r) => r.rows[0]?.content).catch(() => null);
   const defaultTemplate = customTemplate || TEMPLATES[template_type] || "Message from {company_name}";
   const messageText = compileTemplate(defaultTemplate, variables);

   const { provider, mode } = await getActiveProvider(companyId);
   const result = await provider.send(companyId, phone, messageText);

   // Log Notification — wrapped in its own try/catch deliberately: a
   // logging failure must never mask whether the actual message was
   // sent, and must never throw back to a caller that otherwise
   // succeeded at sending.
   try {
     await query(
        `INSERT INTO notification_logs (company_id, message_type, channel, recipient_phone, message_body, status, error_message, provider_id)
         VALUES ($1, $2, 'whatsapp', $3, $4, $5, $6, $7)`,
        [companyId, template_type, phone, messageText, result.status, result.errorLog, mode]
     );
   } catch (logErr: any) {
     console.error('[notification log] failed to record WhatsApp send:', logErr.message);
   }

   return { status: result.status, twilioRef: result.providerRef, delivered: result.status === 'sent', reason: result.status !== 'sent' ? (result.errorLog || result.status) : undefined };
}

export type InvoiceShareVars = {
  party_name: string;
  company_name: string;
  invoice_number: string;
  date: string;
  amount: string;
  link: string;
  phone: string;
};

export async function sendWhatsAppInvoiceLink(
  phone: string,
  vars: InvoiceShareVars,
  companyId: string,
) {
  return sendWhatsApp(phone, 'INVOICE_SHARE', vars, companyId);
}

export async function sendBulkWhatsApp(messages: { phone: string, template_type: string, variables: Record<string, any>, companyId: string }[]) {
   const results = [];
   for (const msg of messages) {
       const res = await sendWhatsApp(msg.phone, msg.template_type, msg.variables, msg.companyId);
       results.push(res);
       await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay required
   }
   return results;
}
