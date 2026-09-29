export type StockValuationRow = {
  quantity?: number | string | null;
  avg_cost_price?: number | string | null;
};

export type StockValuationSummary = {
  stockOnHand: number;
  stockValue: number;
  hasNegativeStock: boolean;
};

const ZERO_TOLERANCE = 0.00005;

/**
 * Stock quantities are decimal units and costs are integer paise. Keep the
 * valuation in paise and force a true zero balance to a zero asset value.
 */
export function calculateStockValuation(rows: StockValuationRow[]): StockValuationSummary {
  let stockOnHand = 0;
  let rawValue = 0;
  let hasNegativeStock = false;

  for (const row of rows) {
    const quantity = Number(row.quantity || 0);
    const unitCost = Number(row.avg_cost_price || 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) continue;
    stockOnHand += quantity;
    rawValue += quantity * unitCost;
    hasNegativeStock ||= quantity < 0;
  }

  const normalizedStock = Math.abs(stockOnHand) < ZERO_TOLERANCE ? 0 : stockOnHand;
  return {
    stockOnHand: normalizedStock,
    stockValue: normalizedStock === 0 ? 0 : Math.round(rawValue),
    hasNegativeStock: hasNegativeStock || normalizedStock < 0,
  };
}
