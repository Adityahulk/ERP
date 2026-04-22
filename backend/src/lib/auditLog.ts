import { query } from '../config/db';
import { logger } from '../config/logger';

/**
 * Log an action in the audit_logs table.
 * Called after any create / update / delete / login / export.
 */
export async function logAction(
  userId: string | null,
  companyId: string,
  action: string,
  entity: string,
  entityId?: string | null,
  oldValue?: any,
  newValue?: any,
  ipAddress?: string | null,
  userAgent?: string | null
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs 
        (company_id, user_id, action, entity, entity_id, old_value, new_value, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        companyId,
        userId,
        action,
        entity,
        entityId || null,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        ipAddress || null,
        userAgent || null,
      ]
    );
  } catch (err) {
    // Audit log failure should never break the main flow
    logger.error('Failed to write audit log:', err);
  }
}
