export const GST_RATE_OPTIONS = [0, 0.1, 0.25, 0.5, 1, 1.5, 3, 5, 6, 7.5, 9, 12, 14, 18, 28, 40] as const;
export const DEFAULT_GST_RATE_OPTIONS = [...GST_RATE_OPTIONS];

export function gstRateLabel(rate: number) {
  if (rate <= 0) return '0% GST (Exempt / Nil / Non-GST)';
  const half = rate / 2;
  return `${rate}% GST (CGST ${half}% + SGST ${half}% / IGST ${rate}%)`;
}

export function companyGstRateOptions(company?: unknown): number[] {
  const settings = company && typeof company === 'object' && !Array.isArray(company)
    ? (company as { tax_settings?: unknown }).tax_settings
    : undefined;
  const raw = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as { enabledSlabs?: unknown; enabled_slabs?: unknown; taxGroups?: unknown; tax_groups?: unknown; groups?: unknown; rates?: unknown; customRates?: unknown; custom_rates?: unknown; enable_gst?: unknown }
    : {};
  if (raw.enable_gst === false) return [0];
  const enabledSlabs = Array.isArray(raw.enabledSlabs) ? raw.enabledSlabs : (Array.isArray(raw.enabled_slabs) ? raw.enabled_slabs : []);
  const fromEnabledSlabs = enabledSlabs.map((rate: any) => Number(rate));
  const enabledSlabSet = new Set(fromEnabledSlabs.map((rate) => String(rate)));
  const groups = Array.isArray(raw.taxGroups) ? raw.taxGroups : (Array.isArray(raw.tax_groups) ? raw.tax_groups : raw.groups);
  const fromGroups = Array.isArray(groups)
    ? groups
        .filter((group: any) => {
          const rate = Number(group?.rate ?? group?.totalRate ?? group?.total_rate ?? 0);
          const isStandardGroup = String(group?.id || '').startsWith('gst_') || /^GST@?\d/i.test(String(group?.name || group?.label || ''));
          return group?.active !== false && group?.isActive !== false && (!isStandardGroup || !enabledSlabSet.size || enabledSlabSet.has(String(rate)));
        })
        .map((group: any) => Number(group?.rate ?? group?.totalRate ?? group?.total_rate ?? 0))
    : [];
  const customRates = Array.isArray(raw.customRates) ? raw.customRates : raw.custom_rates;
  const fromCustomRates = Array.isArray(customRates)
    ? customRates
        .filter((rate: any) => rate?.active !== false && rate?.isActive !== false)
        .map((rate: any) => Number(rate?.rate ?? 0))
    : [];
  const fromRates = Array.isArray(raw.rates)
    ? raw.rates
        .filter((rate: any) => rate?.active !== false && String(rate?.type || '').toUpperCase() === 'IGST')
        .map((rate: any) => Number(rate?.rate ?? 0))
    : [];
  const merged = Array.from(new Set([...fromEnabledSlabs, ...fromCustomRates, ...fromGroups, ...fromRates]
    .filter((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100)
    .map((rate) => Number(rate.toFixed(3)))));
  return merged.length ? merged.sort((a, b) => a - b) : DEFAULT_GST_RATE_OPTIONS;
}
