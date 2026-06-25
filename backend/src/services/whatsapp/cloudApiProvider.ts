import { query } from '../../config/db';
import { decryptSecret } from '../../lib/credentialsCrypto';
import { WhatsAppProvider, WhatsAppSendResult } from './types';

const GRAPH_VERSION = 'v19.0';

async function resolveCredentials(companyId: string): Promise<{ token: string; phoneNumberId: string } | null> {
  const row = await query(
    `SELECT whatsapp_cloud_access_token_encrypted, whatsapp_cloud_phone_number_id FROM companies WHERE id = $1`,
    [companyId],
  ).then((r) => r.rows[0]);
  if (!row?.whatsapp_cloud_access_token_encrypted || !row?.whatsapp_cloud_phone_number_id) return null;
  const token = decryptSecret(row.whatsapp_cloud_access_token_encrypted);
  if (!token) return null;
  return { token, phoneNumberId: row.whatsapp_cloud_phone_number_id };
}

export const cloudApiProvider: WhatsAppProvider = {
  async send(companyId, phone, messageText): Promise<WhatsAppSendResult> {
    const creds = await resolveCredentials(companyId);
    if (!creds) {
      console.log(`[WA Cloud API MOCK] To: ${phone} | Body: ${messageText.replace(/\n/g, ' ')}`);
      return { status: 'bypassed_no_credentials', providerRef: null, errorLog: null };
    }
    try {
      const toNum = (phone.startsWith('+') ? phone : `+91${phone}`).replace(/[^\d+]/g, '');
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toNum.replace('+', ''),
          type: 'text',
          text: { body: messageText, preview_url: false },
        }),
      });
      const data: any = await res.json();
      if (!res.ok) {
        return { status: 'failed', providerRef: null, errorLog: data?.error?.message || `HTTP ${res.status}` };
      }
      return { status: 'sent', providerRef: data?.messages?.[0]?.id || null, errorLog: null };
    } catch (err: any) {
      console.error('[WA Cloud API ERROR]', err.message);
      return { status: 'failed', providerRef: null, errorLog: err.message };
    }
  },

  async testConnection(companyId) {
    const creds = await resolveCredentials(companyId);
    if (!creds) return { connected: false, detail: 'No Cloud API access token / phone number ID configured.' };
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneNumberId}?fields=verified_name,display_phone_number,quality_rating`, {
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      const data: any = await res.json();
      if (!res.ok) return { connected: false, detail: data?.error?.message || `HTTP ${res.status}` };
      return { connected: true, detail: `${data.verified_name || 'Verified'} — ${data.display_phone_number || ''}` };
    } catch (err: any) {
      return { connected: false, detail: err.message };
    }
  },
};
