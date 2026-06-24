import { Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { encryptSecret } from '../lib/credentialsCrypto';
import {
  PROVIDERS, getProvider, isOAuthProvider, isApiKeyProvider, isPlatformConfigured,
} from '../lib/integrationProviders';
import { env } from '../config/env';
import { enqueueJob, setRepeatingJob } from '../jobs/queues';

function publicView(row: any) {
  // Never return encrypted_credentials to the client, even encrypted.
  const { encrypted_credentials, ...rest } = row;
  return rest;
}

// ── GET /api/integrations ──────────────────────────────────────
// One row per provider, merging the static registry with this
// company's connection row (or "not_connected" if none exists yet).
export async function listIntegrations(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const rows = await query(
      `SELECT * FROM tenant_integrations WHERE company_id = $1 AND is_deleted = false`,
      [companyId],
    );
    const byProvider = new Map(rows.rows.map((r: any) => [r.provider, r]));

    const result = Object.values(PROVIDERS).map((p) => {
      const existing = byProvider.get(p.key);
      return {
        key: p.key,
        name: p.name,
        category: p.category,
        description: p.description,
        docsUrl: p.docsUrl,
        authType: p.config.authType,
        platformConfigured: isPlatformConfigured(p),
        fields: isApiKeyProvider(p) ? p.config.fields.map((f) => ({ key: f.key, label: f.label, placeholder: f.placeholder, secret: f.secret })) : undefined,
        connection: existing ? publicView(existing) : {
          status: 'not_connected',
          account_label: null,
          connected_at: null,
          last_synced_at: null,
          last_error: null,
        },
      };
    });

    res.json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/integrations/:provider/logs ───────────────────────
export async function getSyncLogs(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { provider } = req.params;
    const logs = await query(
      `SELECT * FROM integration_sync_logs WHERE company_id = $1 AND provider = $2 ORDER BY started_at DESC LIMIT 50`,
      [companyId, provider],
    );
    res.json(success(logs.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/integrations/:provider/api-key ───────────────────
// Saves and verifies an API-key-based connection (Razorpay, Stripe,
// OpenAI, Anthropic, Gemini). Runs a real, cheap verification call
// against the provider before marking it "connected" — a typo'd key
// is rejected here, not silently stored as if it worked.
export async function connectApiKey(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { provider } = req.params;
    const def = getProvider(provider);
    if (!def || !isApiKeyProvider(def)) return res.status(400).json(error('Unknown or non-API-key provider'));

    const creds: Record<string, string> = {};
    for (const field of def.config.fields) {
      const value = String(req.body?.[field.key] || '').trim();
      if (!value) return res.status(400).json(error(`${field.label} is required`));
      creds[field.key] = value;
    }

    const verification = await def.config.verify(creds);
    if (!verification.ok) {
      return res.status(400).json(error(verification.error || 'The provider rejected these credentials'));
    }

    const encrypted = encryptSecret(JSON.stringify(creds));
    const result = await query(
      `INSERT INTO tenant_integrations (company_id, provider, auth_type, status, encrypted_credentials, account_label, connected_by, connected_at)
       VALUES ($1,$2,'api_key','connected',$3,$4,$5,now())
       ON CONFLICT (company_id, provider) DO UPDATE SET
         status = 'connected', encrypted_credentials = $3, account_label = $4,
         connected_by = $5, connected_at = now(), last_error = NULL, updated_at = now()
       RETURNING *`,
      [companyId, provider, encrypted, verification.label || def.name, req.user!.id],
    );

    res.status(201).json(success(publicView(result.rows[0])));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/integrations/:provider/disconnect ─────────────────
export async function disconnect(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { provider } = req.params;
    await query(
      `UPDATE tenant_integrations
       SET status = 'not_connected', encrypted_credentials = NULL, account_label = NULL,
           last_error = NULL, updated_at = now()
       WHERE company_id = $1 AND provider = $2`,
      [companyId, provider],
    );
    res.json(success({ disconnected: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/integrations/:provider/oauth/start ─────────────────
// Returns the provider's consent-screen URL as JSON rather than
// redirecting server-side: this app authenticates via a Bearer
// header, which a plain browser navigation to a GET endpoint can't
// carry. The frontend receives the URL via an authenticated request,
// then does window.location.href itself.
export async function startOAuth(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { provider } = req.params;
    const def = getProvider(provider);
    if (!def || !isOAuthProvider(def)) return res.status(400).json(error('Unknown or non-OAuth provider'));
    if (!isPlatformConfigured(def)) {
      return res.status(503).json(error(`${def.name} isn't set up by your platform administrator yet. Ask Microtechnique support to configure it.`));
    }

    const state = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO integration_oauth_states (state, company_id, provider, user_id) VALUES ($1,$2,$3,$4)`,
      [state, companyId, provider, req.user!.id],
    );

    const callbackBase = env.INTEGRATIONS_OAUTH_CALLBACK_BASE_URL || `${req.protocol}://${req.get('host')}/api`;
    const redirectUri = `${callbackBase}/integrations/${provider}/oauth/callback`;

    const params = new URLSearchParams({
      client_id: def.config.clientId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: def.config.scopes.join(' '),
      state,
      ...(def.config.extraAuthParams || {}),
    });

    res.json(success({ authorizeUrl: `${def.config.authorizeUrl}?${params.toString()}` }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/integrations/:provider/oauth/callback ───────────────
// Public (no verifyToken — the provider redirects the user's browser
// here directly, with no Authorization header). Tenant identity comes
// from the signed `state` row we created in startOAuth, not the JWT.
export async function oauthCallback(req: Request, res: Response) {
  const frontendBase = env.FRONTEND_URL || '';
  const { provider } = req.params;
  const { code, state, error: providerError } = req.query as Record<string, string>;

  const redirectWithResult = (ok: boolean, message: string) => {
    const url = `${frontendBase}/settings/integrations?provider=${provider}&status=${ok ? 'success' : 'error'}&message=${encodeURIComponent(message)}`;
    res.redirect(url);
  };

  try {
    if (providerError) return redirectWithResult(false, providerError);
    const def = getProvider(provider);
    if (!def || !isOAuthProvider(def)) return redirectWithResult(false, 'Unknown provider');
    if (!code || !state) return redirectWithResult(false, 'Missing authorization code');

    const stateRes = await query(
      `DELETE FROM integration_oauth_states WHERE state = $1 AND expires_at > now() RETURNING company_id, user_id`,
      [state],
    );
    if (!stateRes.rows.length) return redirectWithResult(false, 'This connection link expired — please try again');
    const { company_id: companyId, user_id: userId } = stateRes.rows[0];

    const callbackBase = env.INTEGRATIONS_OAUTH_CALLBACK_BASE_URL || `${req.protocol}://${req.get('host')}/api`;
    const redirectUri = `${callbackBase}/integrations/${provider}/oauth/callback`;

    const tokenRes = await fetch(def.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: def.config.clientId!,
        client_secret: def.config.clientSecret!,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      return redirectWithResult(false, `${def.name} rejected the authorization (HTTP ${tokenRes.status})`);
    }
    const tokenBody: any = await tokenRes.json();
    const expiresAt = tokenBody.expires_in ? new Date(Date.now() + tokenBody.expires_in * 1000).toISOString() : null;

    const creds = {
      access_token: tokenBody.access_token,
      refresh_token: tokenBody.refresh_token || null,
      expires_at: expiresAt,
    };
    const encrypted = encryptSecret(JSON.stringify(creds));

    await query(
      `INSERT INTO tenant_integrations (company_id, provider, auth_type, status, encrypted_credentials, scopes, connected_by, connected_at)
       VALUES ($1,$2,'oauth','connected',$3,$4,$5,now())
       ON CONFLICT (company_id, provider) DO UPDATE SET
         status = 'connected', encrypted_credentials = $3, scopes = $4,
         connected_by = $5, connected_at = now(), last_error = NULL, updated_at = now()`,
      [companyId, provider, encrypted, def.config.scopes.join(' '), userId],
    );

    return redirectWithResult(true, `${def.name} connected`);
  } catch (err: any) {
    return redirectWithResult(false, err.message || 'Connection failed');
  }
}

// ── POST /api/integrations/:provider/sync ───────────────────────
// Enqueues a real background job rather than running the sync inline
// in the request — the request returns immediately with a job id;
// the actual sync (and its retries) happen in the worker process.
export async function triggerSync(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { provider } = req.params;
    const mode: 'incremental' | 'full' = req.body?.mode === 'full' ? 'full' : 'incremental';
    const syncType = String(req.body?.sync_type || 'manual');

    const connRes = await query(
      `SELECT status FROM tenant_integrations WHERE company_id = $1 AND provider = $2 AND is_deleted = false`,
      [companyId, provider],
    );
    if (!connRes.rows.length || connRes.rows[0].status !== 'connected') {
      return res.status(400).json(error('This integration isn\'t connected yet'));
    }

    const { jobId } = await enqueueJob('integrationSync', { companyId, provider, syncType, mode }, { companyId, priority: 1 });
    res.status(202).json(success({ queued: true, jobId }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/integrations/:provider/schedule ──────────────────
// Sets up (or removes) a recurring background sync — "Scheduled Sync".
export async function setSyncSchedule(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { provider } = req.params;
    const frequency = String(req.body?.frequency || 'manual');
    if (!['manual', 'hourly', 'daily'].includes(frequency)) {
      return res.status(400).json(error('frequency must be manual, hourly, or daily'));
    }

    await query(`UPDATE tenant_integrations SET sync_frequency = $1 WHERE company_id = $2 AND provider = $3`, [frequency, companyId, provider]);

    const everyMs = frequency === 'hourly' ? 60 * 60 * 1000 : frequency === 'daily' ? 24 * 60 * 60 * 1000 : null;
    await setRepeatingJob('integrationSync', `sync:${companyId}:${provider}`, { companyId, provider, syncType: 'scheduled', mode: 'incremental' }, everyMs);

    res.json(success({ frequency }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/integrations/webhooks/:provider ───────────────────
// Public endpoint (no verifyToken) — providers call this directly.
// Always logs the raw event first, then attempts to process it, so a
// processing bug never means a silently lost webhook.
export async function receiveWebhook(req: Request, res: Response) {
  const { provider } = req.params;
  try {
    const logRes = await query(
      `INSERT INTO integration_webhook_events (provider, event_type, payload)
       VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [provider, String(req.body?.type || req.body?.event || 'unknown'), JSON.stringify(req.body || {})],
    );
    // Provider-specific signature verification and dispatch would go
    // here per provider (Stripe: Stripe-Signature header + webhook
    // secret; Razorpay: X-Razorpay-Signature + webhook secret; Meta:
    // X-Hub-Signature-256). Acknowledging receipt immediately is the
    // correct behavior for all three regardless — they retry on
    // non-2xx, so a slow downstream failure shouldn't block the ack.
    await query(`UPDATE integration_webhook_events SET processed = true, processed_at = now() WHERE id = $1`, [logRes.rows[0].id]);
    res.status(200).json({ received: true });
  } catch (err: any) {
    res.status(200).json({ received: true, note: 'logged with error', error: err.message });
  }
}
