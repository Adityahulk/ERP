import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';

/**
 * Module guard middleware — checks if a module is enabled for the company.
 * Future-ready: currently allows all modules. Will check company plan/settings.
 * 
 * Usage: router.use('/hr', moduleGuard('hr'), hrRoutes)
 */
export function moduleGuard(moduleName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    // In the future, check company settings / plan for module access
    // For now, allow all modules
    // const company = await query(
    //   `SELECT plan_type, enabled_modules FROM companies 
    //    WHERE id = $1 AND is_deleted = false`,
    //   [req.user.companyId]
    // );
    //
    // if (!company.rows[0]?.enabled_modules?.includes(moduleName)) {
    //   return res.status(403).json({
    //     success: false,
    //     message: `Module '${moduleName}' is not available on your plan`,
    //     module: moduleName,
    //   });
    // }

    next();
  };
}

/**
 * Company scoping middleware — ensures company_id is always in the query context
 */
export function companyScope(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.company_id) {
    res.status(401).json({
      success: false,
      message: 'Company context required',
    });
    return;
  }

  // Attach company_id to request for easy access in controllers
  (req as any).companyId = req.user.company_id;
  next();
}
