/**
 * Standardized API response helpers.
 * All routes MUST use these instead of raw res.json().
 */

export function success(data: any, meta?: any) {
  return {
    success: true as const,
    data,
    ...(meta !== undefined && { meta }),
  };
}

export function error(message: string, errors?: Array<{ field?: string; message: string }>) {
  return {
    success: false as const,
    error: message,
    ...(errors && { errors }),
  };
}

export function paginated(data: any[], pagination: any, meta?: any) {
  return {
    success: true as const,
    data,
    pagination,
    ...(meta !== undefined && { meta }),
  };
}
