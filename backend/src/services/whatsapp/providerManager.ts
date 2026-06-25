import { query } from '../../config/db';
import { twilioProvider } from './twilioProvider';
import { cloudApiProvider } from './cloudApiProvider';
import { WhatsAppProvider } from './types';

export async function getActiveProvider(companyId: string): Promise<{ provider: WhatsAppProvider; mode: string }> {
  const row = await query(`SELECT whatsapp_mode FROM companies WHERE id = $1`, [companyId]).then((r) => r.rows[0]);
  const mode = row?.whatsapp_mode || 'twilio';

  if (mode === 'cloud_api') return { provider: cloudApiProvider, mode };
  // 'qr_login' has no real provider behind it — see the Settings UI
  // and migration comments for why. Falling back to Twilio here would
  // silently send messages through a different channel than what the
  // user selected, which is worse than an explicit, visible failure.
  if (mode === 'qr_login') {
    return {
      provider: {
        async send() { return { status: 'failed' as const, providerRef: null, errorLog: 'WhatsApp Web QR Login is not connected — this mode has no real session backing it. Switch to Twilio or Cloud API in Settings → WhatsApp.' }; },
        async testConnection() { return { connected: false, detail: 'QR Login has no real implementation — see Settings → WhatsApp for why.' }; },
      },
      mode,
    };
  }
  return { provider: twilioProvider, mode: 'twilio' };
}
