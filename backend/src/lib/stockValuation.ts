export type StockValuationRow = {
  quantity?: number | string | null;
  avg_cost_price?: number | string | null;
};

export type StockValuationSummary = {
  stockOnHand: number;
  /** Value of physical stock that is currently on hand (never negative). */
  stockValue: number;
  /** Cost value required to fulfil negative/backordered godown quantities. */
  stockShortfallValue: number;
  hasNegativeStock: boolean;
};

const ZERO_TOLERANCE = 0.00005;

/** Calculate an opening inventory value from decimal quantity and paise/unit. */
export function calculateOpeningStockValuePaise(quantityValue: unknown, unitPricePaiseValue: unknown): number {
  const quantity = Number(quantityValue || 0);
  const unitPricePaise = Number(unitPricePaiseValue || 0);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Opening stock quantity must be a non-negative number');
  if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise < 0) throw new Error('Purchase price exceeds the supported range');
  const value = Math.round(quantity * unitPricePaise);
  if (!Number.isSafeInteger(value)) throw new Error('Opening stock value exceeds the supported range');
  return value;
}

/**
 * Stock quantities are decimal units and costs are integer paise. Keep the
 * valuation in paise and force a true zero balance to a zero asset value.
 */
export function calculateStockValuation(rows: StockValuationRow[]): StockValuationSummary {
  let stockOnHand = 0;
  let positiveValue = 0;
  let shortfallValue = 0;
  let hasNegativeStock = false;

  for (const row of rows) {
    const quantity = Number(row.quantity || 0);
    const unitCost = Number(row.avg_cost_price || 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) continue;
    stockOnHand += quantity;
    if (quantity < 0) {
      hasNegativeStock = true;
      shortfallValue += Math.abs(quantity) * unitCost;
    } else {
      positiveValue += quantity * unitCost;
    }
  }

  const normalizedStock = Math.abs(stockOnHand) < ZERO_TOLERANCE ? 0 : stockOnHand;
  return {
    stockOnHand: normalizedStock,
    stockValue: Math.round(positiveValue),
    stockShortfallValue: Math.round(shortfallValue),
    hasNegativeStock: hasNegativeStock || normalizedStock < 0,
  };
}
