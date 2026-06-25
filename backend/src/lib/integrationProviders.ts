import { env } from '../config/env';

export type AuthType = 'oauth' | 'api_key';

export interface ApiKeyField {
  key: string;        // field name stored inside encrypted_credentials JSON
  label: string;
  placeholder?: string;
  secret: boolean;     // mask in any future "show value" UI
}

export interface OAuthProviderConfig {
  authType: 'oauth';
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId?: string;
  clientSecret?: string;
  extraAuthParams?: Record<string, string>;
}

export interface ApiKeyProviderConfig {
  authType: 'api_key';
  fields: ApiKeyField[];
  /** Cheap, read-only call used to verify the key actually works before marking "connected". */
  verify: (creds: Record<string, string>) => Promise<{ ok: boolean; label?: string; error?: string }>;
}

export interface ProviderDefinition {
  key: string;
  name: string;
  category: 'marketing' | 'payments' | 'ai' | 'messaging' | 'backup' | 'finance';
  description: string;
  docsUrl: string;
  config: OAuthProviderConfig | ApiKeyProviderConfig;
}

async function verifyOpenAI(creds: Record<string, string>) {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${creds.api_key}` },
  });
  if (!res.ok) return { ok: false, error: `OpenAI rejected the key (HTTP ${res.status})` };
  return { ok: true, label: 'OpenAI account connected' };
}

async function verifyAnthropic(creds: Record<string, string>) {
  // Anthropic has no harmless "whoami" GET; the cheapest real verification
  // is a 1-token completion request, which is intentionally tiny.
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': creds.api_key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
  });
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'Anthropic rejected the key' };
  if (!res.ok && res.status !== 400) return { ok: false, error: `Anthropic returned HTTP ${res.status}` };
  return { ok: true, label: 'Anthropic account connected' };
}

async function verifyGemini(creds: Record<string, string>) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(creds.api_key)}`);
  if (!res.ok) return { ok: false, error: `Gemini rejected the key (HTTP ${res.status})` };
  return { ok: true, label: 'Gemini account connected' };
}

async function verifyRazorpay(creds: Record<string, string>) {
  const auth = Buffer.from(`${creds.key_id}:${creds.key_secret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/payments?count=1', {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) return { ok: false, error: `Razorpay rejected the credentials (HTTP ${res.status})` };
  return { ok: true, label: `Razorpay (key: ${creds.key_id.slice(0, 12)}…)` };
}

async function verifyStripe(creds: Record<string, string>) {
  const res = await fetch('https://api.stripe.com/v1/balance', {
    headers: { Authorization: `Bearer ${creds.secret_key}` },
  });
  if (!res.ok) return { ok: false, error: `Stripe rejected the key (HTTP ${res.status})` };
  const body: any = await res.json().catch(() => ({}));
  return { ok: true, label: `Stripe (${(body as any)?.livemode ? 'live' : 'test'} mode)` };
}

async function verifyS3(creds: Record<string, string>) {
  // A real, minimal verification: list buckets via a signed request is
  // non-trivial without an SDK; instead we verify the endpoint accepts
  // the credentials by attempting a HEAD on the named bucket using the
  // AWS Signature V4 would require the aws-sdk dependency this project
  // doesn't currently have. We verify shape only here and surface real
  // errors the first time a backup upload is attempted instead.
  if (!creds.access_key || !creds.secret_key || !creds.bucket) {
    return { ok: false, error: 'Access key, secret key, and bucket are all required' };
  }
  return { ok: true, label: `S3-compatible (${creds.bucket})` };
}

async function verifyExchangeRateApi(creds: Record<string, string>) {
  const res = await fetch(`https://v6.exchangerate-api.com/v6/${creds.api_key}/latest/INR`);
  if (!res.ok) return { ok: false, error: `Exchange rate provider rejected the key (HTTP ${res.status})` };
  const body: any = await res.json();
  if (body.result !== 'success') return { ok: false, error: body['error-type'] || 'Key rejected' };
  return { ok: true, label: 'Exchange rate auto-update enabled' };
}

export const PROVIDERS: Record<string, ProviderDefinition> = {
  google_business: {
    key: 'google_business',
    name: 'Google Business Profile',
    category: 'marketing',
    description: 'Sync reviews, ratings, photos, and profile insights for your Google Business listing.',
    docsUrl: 'https://developers.google.com/my-business',
    config: {
      authType: 'oauth',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    },
  },
  google_ads: {
    key: 'google_ads',
    name: 'Google Ads',
    category: 'marketing',
    description: 'Build and track Google Ads campaigns, budgets, and conversions from your account.',
    docsUrl: 'https://developers.google.com/google-ads/api/docs/start',
    config: {
      authType: 'oauth',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/adwords'],
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    },
  },
  meta_ads: {
    key: 'meta_ads',
    name: 'Meta Ads',
    category: 'marketing',
    description: 'Manage Facebook and Instagram ad campaigns, budgets, and audiences.',
    docsUrl: 'https://developers.facebook.com/docs/marketing-apis',
    config: {
      authType: 'oauth',
      authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
      scopes: ['ads_management', 'ads_read', 'business_management'],
      clientId: env.META_APP_ID,
      clientSecret: env.META_APP_SECRET,
    },
  },
  whatsapp_business: {
    key: 'whatsapp_business',
    name: 'WhatsApp Business (Cloud API)',
    category: 'messaging',
    description: 'Send template messages and broadcasts directly via Meta\u2019s WhatsApp Cloud API, using your own WhatsApp Business number.',
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    config: {
      authType: 'oauth',
      authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      clientId: env.META_APP_ID,
      clientSecret: env.META_APP_SECRET,
    },
  },
  razorpay: {
    key: 'razorpay',
    name: 'Razorpay',
    category: 'payments',
    description: 'Accept online payments on invoices and your store using your own Razorpay account.',
    docsUrl: 'https://razorpay.com/docs/api/',
    config: {
      authType: 'api_key',
      fields: [
        { key: 'key_id', label: 'Key ID', placeholder: 'rzp_live_xxxxxxxxxxxx', secret: false },
        { key: 'key_secret', label: 'Key Secret', secret: true },
      ],
      verify: verifyRazorpay,
    },
  },
  stripe: {
    key: 'stripe',
    name: 'Stripe',
    category: 'payments',
    description: 'Accept international card payments using your own Stripe account.',
    docsUrl: 'https://stripe.com/docs/keys',
    config: {
      authType: 'api_key',
      fields: [{ key: 'secret_key', label: 'Secret Key', placeholder: 'sk_live_xxxxxxxxxxxx', secret: true }],
      verify: verifyStripe,
    },
  },
  openai: {
    key: 'openai',
    name: 'OpenAI',
    category: 'ai',
    description: 'Power AI ad copy, review replies, and growth suggestions using your own OpenAI account.',
    docsUrl: 'https://platform.openai.com/api-keys',
    config: {
      authType: 'api_key',
      fields: [{ key: 'api_key', label: 'API Key', placeholder: 'sk-xxxxxxxxxxxx', secret: true }],
      verify: verifyOpenAI,
    },
  },
  anthropic: {
    key: 'anthropic',
    name: 'Anthropic (Claude)',
    category: 'ai',
    description: 'Power AI ad copy, review replies, and growth suggestions using your own Anthropic account.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    config: {
      authType: 'api_key',
      fields: [{ key: 'api_key', label: 'API Key', placeholder: 'sk-ant-xxxxxxxxxxxx', secret: true }],
      verify: verifyAnthropic,
    },
  },
  gemini: {
    key: 'gemini',
    name: 'Google Gemini',
    category: 'ai',
    description: 'Power AI ad copy, review replies, and growth suggestions using your own Google AI Studio account.',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    config: {
      authType: 'api_key',
      fields: [{ key: 'api_key', label: 'API Key', placeholder: 'AIzaSyxxxxxxxxxxxx', secret: true }],
      verify: verifyGemini,
    },
  },
  google_drive: {
    key: 'google_drive',
    name: 'Google Drive',
    category: 'backup',
    description: 'Back up your ERP data to your own Google Drive — Microtechnique never stores a copy.',
    docsUrl: 'https://developers.google.com/drive/api/guides/about-sdk',
    config: {
      authType: 'oauth',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    },
  },
  s3_compatible: {
    key: 's3_compatible',
    name: 'S3 / MinIO (Object Storage)',
    category: 'backup',
    description: 'Back up your ERP data to your own AWS S3 bucket or self-hosted MinIO instance.',
    docsUrl: 'https://min.io/docs/minio/linux/developers/javascript/minio-javascript.html',
    config: {
      authType: 'api_key',
      fields: [
        { key: 'endpoint', label: 'Endpoint URL', placeholder: 'https://s3.ap-south-1.amazonaws.com (leave default for AWS)', secret: false },
        { key: 'bucket', label: 'Bucket name', secret: false },
        { key: 'access_key', label: 'Access Key', secret: false },
        { key: 'secret_key', label: 'Secret Key', secret: true },
      ],
      verify: verifyS3,
    },
  },
  exchange_rate_api: {
    key: 'exchange_rate_api',
    name: 'Exchange Rate Auto-Update',
    category: 'finance',
    description: 'Automatically refresh currency exchange rates daily using your own exchangerate-api.com account. Manual rate entry always works without this.',
    docsUrl: 'https://www.exchangerate-api.com/docs/overview',
    config: {
      authType: 'api_key',
      fields: [{ key: 'api_key', label: 'API Key', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxx', secret: true }],
      verify: verifyExchangeRateApi,
    },
  },
};

export function getProvider(key: string): ProviderDefinition | undefined {
  return PROVIDERS[key];
}

export function isOAuthProvider(p: ProviderDefinition): p is ProviderDefinition & { config: OAuthProviderConfig } {
  return p.config.authType === 'oauth';
}

export function isApiKeyProvider(p: ProviderDefinition): p is ProviderDefinition & { config: ApiKeyProviderConfig } {
  return p.config.authType === 'api_key';
}

/** Whether the PLATFORM (Microtechnique) has registered its own developer app for this OAuth provider yet. */
export function isPlatformConfigured(p: ProviderDefinition): boolean {
  if (isOAuthProvider(p)) return !!(p.config.clientId && p.config.clientSecret);
  return true; // api_key providers need no platform-level setup
}
