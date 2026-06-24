import { Job } from 'bullmq';
import { withJobRunTracking } from '../jobRunTracking';
import { syncIntegration } from '../../services/integrationSyncService';

export async function processIntegrationSync(job: Job) {
  return withJobRunTracking(job, async () => {
    const { companyId, provider, syncType, mode } = job.data;
    return syncIntegration(companyId, provider, syncType || 'scheduled', mode || 'incremental');
  });
}

/** Google Business Sync queue — same engine, fixed to one provider, so it can have its own schedule/rate-limit/monitoring independent of other integrations. */
export async function processGoogleBusinessSync(job: Job) {
  return withJobRunTracking(job, async () => {
    const { companyId, syncType, mode } = job.data;
    return syncIntegration(companyId, 'google_business', syncType || 'scheduled', mode || 'incremental');
  });
}

/** Ads Sync queue — covers Meta Ads (real) and Google Ads (clearly errors — needs a developer token, see integrationSyncService). */
export async function processAdsSync(job: Job) {
  return withJobRunTracking(job, async () => {
    const { companyId, provider, syncType, mode } = job.data;
    const targetProvider = provider === 'google_ads' ? 'google_ads' : 'meta_ads';
    return syncIntegration(companyId, targetProvider, syncType || 'scheduled', mode || 'incremental');
  });
}
