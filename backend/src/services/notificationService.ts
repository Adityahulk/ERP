import twilio from 'twilio';
import { query } from '../config/db';

const SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH = process.env.TWILIO_AUTH_TOKEN;
const WA_NUM = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

const client = SID && AUTH ? twilio(SID, AUTH) : null;

// Built-in basic templates matching the specification
const TEMPLATES: Record<string, string> = {
  INVOICE_SHARE: "Dear {party_name},\n\nYour invoice from {company_name}:\nInvoice No: {invoice_number}\nDate: {date}\nAmount: ₹{amount}\n\nView & Download: {link}\n\nFor queries: {phone}\n— {company_name}",
  PAYMENT_REMINDER: "Dear {party_name},\n\nThis is a reminder for pending payment:\nInvoice: {invoice_number} dated {date}\nDue: {due_date}\nAmount Due: ₹{amount}\n\nPlease make the payment at your earliest.\n📞 {phone}\n— {company_name}",
  LOW_STOCK_ALERT: "📦 Low Stock Alert — {company_name}\n{item_name} ({sku}) is running low.\nCurrent Stock: {quantity} {unit}\nReorder Level: {reorder_point}\nPlease reorder from your supplier."
};

/**
 * Replaces `{key}` blocks with values from the given record.
 */
function compileTemplate(template: string, variables: Record<string, any>) {
   return template.replace(/{(\w+)}/g, (_, k) => variables[k] !== undefined ? variables[k] : `{${k}}`);
}

export async function sendWhatsApp(phone: string, template_type: string, variables: Record<string, any>, companyId: string) {
   const defaultTemplate = TEMPLATES[template_type] || "Message from {company_name}";
   const messageText = compileTemplate(defaultTemplate, variables);

   let status = 'pending';
   let twilioRef = null;
   let errorLog = null;

   try {
      if(client) {
         // Formatted to E.164 if not already (assuming mostly Indian format for now)
         const toNum = phone.startsWith('+') ? phone : `+91${phone}`;
         const msg = await client.messages.create({
            body: messageText,
            from: WA_NUM,
            to: `whatsapp:${toNum}`
         });
         twilioRef = msg.sid;
         status = 'sent';
      } else {
         status = 'bypassed_no_credentials';
         console.log(`[WA MOCK] To: ${phone} | Body: ${messageText.replace(/\n/g, ' ')}`);
      }
   } catch (error: any) {
      status = 'failed';
      errorLog = error.message;
      console.error('[WA ERROR]', error.message);
   }

   // Log Notification
   await query(
      `INSERT INTO notification_logs (company_id, type, channel, recipient_id, payload, status, error_log) 
       VALUES ($1, $2, 'whatsapp', $3, $4, $5, $6)`,
      [companyId, template_type, phone, JSON.stringify(variables), status, errorLog]
   );

   return { status, twilioRef };
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
