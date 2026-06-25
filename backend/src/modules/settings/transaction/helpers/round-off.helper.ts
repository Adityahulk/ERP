export type RoundOffType = 'NEAREST' | 'FLOOR' | 'CEIL';

export function applyRoundOff(amount: number, roundOffType: RoundOffType, roundOffTo: 1 | 10 | 100) {
  const base = Number(roundOffTo || 1);
  const value = Number(amount || 0);
  const rounded =
    roundOffType === 'FLOOR'
      ? Math.floor(value / base) * base
      : roundOffType === 'CEIL'
        ? Math.ceil(value / base) * base
        : Math.round(value / base) * base;
  return {
    originalTotal: value,
    roundedTotal: rounded,
    roundOff: rounded - value,
  };
}
