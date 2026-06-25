import twilio from 'twilio';
import { query } from '../../config/db';
import { decryptSecret } from '../../lib/credentialsCrypto';
import { WhatsAppProvider, WhatsAppSendResult } from './types';

const ENV_SID = process.env.TWILIO_ACCOUNT_SID;
const ENV_AUTH = process.env.TWILIO_AUTH_TOKEN;
const ENV_WA_NUM = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

/** Per-company credentials if configured (Settings → WhatsApp), else
 * the platform-wide env-var account. This was the actual gap: the
 * Settings UI saved per-company Twilio config to the database, but
 * sending only ever read process.env — meaning every company shared
 * one Twilio number regardless of what they configured. */
async function resolveCredentials(companyId: string): Promise<{ sid: string; auth: string; waNumber: string } | null> {
  const row = await query(
    `SELECT whatsapp_twilio_account_sid, whatsapp_twilio_auth_token_encrypted, whatsapp_twilio_number FROM companies WHERE id = $1`,
    [companyId],
  ).then((r) => r.rows[0]);

  if (row?.whatsapp_twilio_account_sid && row?.whatsapp_twilio_auth_token_encrypted) {
    const auth = decryptSecret(row.whatsapp_twilio_auth_token_encrypted);
    if (auth) {
      const num = String(row.whatsapp_twilio_number || '').startsWith('whatsapp:')
        ? row.whatsapp_twilio_number
        : `whatsapp:${row.whatsapp_twilio_number}`;
      return { sid: row.whatsapp_twilio_account_sid, auth, waNumber: num };
    }
  }

  if (ENV_SID && ENV_AUTH && ENV_SID.startsWith('AC')) {
    return { sid: ENV_SID, auth: ENV_AUTH, waNumber: ENV_WA_NUM };
  }
  return null;
}

export const twilioProvider: WhatsAppProvider = {
  async send(companyId, phone, messageText): Promise<WhatsAppSendResult> {
    const creds = await resolveCredentials(companyId);
    if (!creds) {
      console.log(`[WA MOCK] To: ${phone} | Body: ${messageText.replace(/\n/g, ' ')}`);
      return { status: 'bypassed_no_credentials', providerRef: null, errorLog: null };
    }
    try {
      const client = twilio(creds.sid, creds.auth);
      const toNum = phone.startsWith('+') ? phone : `+91${phone}`;
      const msg = await client.messages.create({ body: messageText, from: creds.waNumber, to: `whatsapp:${toNum}` });
      return { status: 'sent', providerRef: msg.sid, errorLog: null };
    } catch (err: any) {
      console.error('[WA Twilio ERROR]', err.message);
      return { status: 'failed', providerRef: null, errorLog: err.message };
    }
  },

  async testConnection(companyId) {
    const creds = await resolveCredentials(companyId);
    if (!creds) return { connected: false, detail: 'No Twilio credentials configured for this company or the platform.' };
    try {
      const client = twilio(creds.sid, creds.auth);
      const account = await client.api.v2010.accounts(creds.sid).fetch();
      return { connected: true, detail: `Account status: ${account.status}` };
    } catch (err: any) {
      return { connected: false, detail: err.message };
    }
  },
};
