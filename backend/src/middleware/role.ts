import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { normalizeRole, roleLevel } from '../lib/roles';

export const ROLE_HIERARCHY: Record<string, number> = {
  staff: 10,
  manager: 20,
  admin: 30,
  super_admin: 99,
};

/**
 * Require user role to be one of the specified roles.
 * super_admin always passes.
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const actualRole = normalizeRole(req.user.role);
    if (actualRole === 'super_admin') { next(); return; }
    if (allowedRoles.map(normalizeRole).includes(actualRole)) { next(); return; }
    res.status(403).json({ success: false, error: 'Insufficient permissions', required: allowedRoles });
  };
}

/**
 * Require user role to be at or above the specified minimum level.
 * E.g., requireMinRole('manager') allows manager, accountant, company_admin, super_admin
 */
export function requireMinRole(minRole: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const userLevel = roleLevel(req.user.role);
    const requiredLevel = ROLE_HIERARCHY[normalizeRole(minRole)] ?? 999;
    if (userLevel >= requiredLevel) { next(); return; }
    res.status(403).json({ success: false, error: 'Insufficient permissions', minimumRole: minRole });
  };
}

/**
 * Verify company_id isolation — ensures the requested entity belongs to the user's company.
 * Tablename is developer-supplied (safe), paramName is the URL param holding the entity ID.
 */
export function requireOwnership(tableName: string, paramName: string = 'id') {
  const ALLOWED_TABLES = [
    'items', 'parties', 'invoices', 'purchase_invoices', 'purchase_orders',
    'quotations', 'payments', 'godowns', 'users', 'item_categories', 'item_units',
    'stock_transfers', 'stock_adjustments', 'expenses', 'accounts', 'journal_entries',
    'employee_profiles', 'leave_applications', 'attendance',
  ];

  if (!ALLOWED_TABLES.includes(tableName)) {
    throw new Error(`requireOwnership: table "${tableName}" is not in allowlist`);
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    if (normalizeRole(req.user.role) === 'super_admin') {
      next();
      return;
    }
    const entityId = req.params[paramName];
    if (!entityId) { next(); return; }

    const result = await query(
      `SELECT company_id FROM ${tableName} WHERE id = $1 AND is_deleted = false`,
      [entityId]
    );

    if (!result.rows.length || result.rows[0].company_id !== req.user.company_id) {
      res.status(404).json({ success: false, error: 'Resource not found' });
      return;
    }
    next();
  };
}
