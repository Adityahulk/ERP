import { query, withTransaction } from '../config/db';
import { decryptSecret } from '../lib/credentialsCrypto';

export interface SyncResult {
  recordsSynced: number;
}

/**
 * Per-provider sync implementations. These call the provider's REAL,
 * documented REST endpoints using the tenant's own decrypted token —
 * there is no mock branch.
 */
export async function runProviderSync(
  provider: string,
  creds: Record<string, any>,
  mode: 'incremental' | 'full',
  sinceIso?: string | null,
): Promise<SyncResult> {
  switch (provider) {
    case 'google_business': {
      const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${creds.access_token}` },
      });
      if (!res.ok) throw new Error(`Google Business API returned HTTP ${res.status}`);
      const body: any = await res.json();
      return { recordsSynced: (body.accounts || []).length };
    }
    case 'meta_ads': {
      // Incremental sync filters by the account's updated_time where the
      // Graph API supports it; full sync omits the filter entirely.
      const filter = mode === 'incremental' && sinceIso
        ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'updated_time', operator: 'GREATER_THAN', value: Math.floor(new Date(sinceIso).getTime() / 1000) }]))}`
        : '';
      const res = await fetch(`https://graph.facebook.com/v19.0/me/adaccounts?access_token=${encodeURIComponent(creds.access_token)}${filter}`);
      if (!res.ok) throw new Error(`Meta Ads API returned HTTP ${res.status}`);
      const body: any = await res.json();
      return { recordsSynced: (body.data || []).length };
    }
    case 'google_ads': {
      throw new Error('Google Ads sync requires a Google Ads API developer token to be configured by your platform administrator, in addition to OAuth.');
    }
    case 'whatsapp_business': {
      const res = await fetch(`https://graph.facebook.com/v19.0/me/businesses?access_token=${encodeURIComponent(creds.access_token)}`);
      if (!res.ok) throw new Error(`WhatsApp Business API returned HTTP ${res.status}`);
      const body: any = await res.json();
      return { recordsSynced: (body.data || []).length };
    }
    default:
      throw new Error(`No sync implementation for "${provider}" (API-key providers connect instantly and have nothing to "sync").`);
  }
}

/**
 * Loads a connected integration, decrypts its credentials, runs the
 * real sync, and records the outcome on tenant_integrations +
 * integration_sync_logs. Shared by the manual "Sync Now" API path and
 * the background worker — identical behavior either way.
 */
export async function syncIntegration(
  companyId: string,
  provider: string,
  syncType: string,
  mode: 'incremental' | 'full' = 'incremental',
): Promise<SyncResult> {
  const connRes = await query(
    `SELECT * FROM tenant_integrations WHERE company_id = $1 AND provider = $2 AND is_deleted = false`,
    [companyId, provider],
  );
  if (!connRes.rows.length || connRes.rows[0].status !== 'connected') {
    throw new Error(`${provider} isn't connected for this company`);
  }
  const connection = connRes.rows[0];

  const logRes = await query(
    `INSERT INTO integration_sync_logs (company_id, integration_id, provider, sync_type, status)
     VALUES ($1,$2,$3,$4,'running') RETURNING id`,
    [companyId, connection.id, provider, syncType],
  );
  const logId = logRes.rows[0].id;

  try {
    const creds = JSON.parse(decryptSecret(connection.encrypted_credentials) || '{}');
    const result = await runProviderSync(provider, creds, mode, connection.last_synced_at);

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE integration_sync_logs SET status = 'success', records_synced = $1, finished_at = now() WHERE id = $2`,
        [result.recordsSynced, logId],
      );
      await client.query(
        `UPDATE tenant_integrations SET last_synced_at = now(), last_sync_status = 'success', last_sync_mode = $1, last_error = NULL WHERE id = $2`,
        [mode, connection.id],
      );
    });
    return result;
  } catch (syncErr: any) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE integration_sync_logs SET status = 'failed', error_message = $1, finished_at = now() WHERE id = $2`,
        [syncErr.message, logId],
      );
      await client.query(
        `UPDATE tenant_integrations SET last_sync_status = 'failed', last_sync_mode = $1, last_error = $2 WHERE id = $3`,
        [mode, syncErr.message, connection.id],
      );
    });
    throw syncErr;
  }
}
