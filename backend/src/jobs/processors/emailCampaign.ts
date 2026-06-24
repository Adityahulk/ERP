import { Job } from 'bullmq';
import { query } from '../../config/db';
import { sendMail } from '../../services/mailer';
import { withJobRunTracking } from '../jobRunTracking';

export async function processEmailCampaign(job: Job) {
  return withJobRunTracking(job, async () => {
    const { campaignId, companyId } = job.data;

    const campaignRes = await query(`SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND is_deleted = false`, [campaignId, companyId]);
    if (!campaignRes.rows.length) throw new Error('Campaign not found');
    const campaign = campaignRes.rows[0];

    await query(`UPDATE campaigns SET status = 'sending' WHERE id = $1`, [campaignId]);

    const recipients = await query(`SELECT * FROM campaign_recipients WHERE campaign_id = $1 AND status = 'pending'`, [campaignId]);

    let sent = 0;
    let failed = 0;
    for (const r of recipients.rows) {
      try {
        const result = await sendMail({
          to: r.contact,
          subject: campaign.subject || campaign.name,
          html: `<p>${String(campaign.message).replace(/\n/g, '<br/>')}</p>`,
          text: campaign.message,
        });
        if (!result.delivered) throw new Error(result.reason || 'Delivery failed');
        await query(`UPDATE campaign_recipients SET status = 'sent', sent_at = now() WHERE id = $1`, [r.id]);
        sent++;
      } catch (err: any) {
        await query(`UPDATE campaign_recipients SET status = 'failed', error = $1 WHERE id = $2`, [err.message, r.id]);
        failed++;
      }
    }

    await query(
      `UPDATE campaigns SET status = 'completed', sent_count = sent_count + $1, failed_count = failed_count + $2 WHERE id = $3`,
      [sent, failed, campaignId],
    );

    return { recipientsProcessed: recipients.rows.length, sent, failed };
  });
}
