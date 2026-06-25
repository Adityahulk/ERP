import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export const STANDARD_GST_SLABS = [0, 0.1, 0.25, 0.5, 1, 1.5, 3, 5, 6, 7.5, 9, 12, 14, 18, 28, 40];

export type TaxComponent = { type: string; rate: number };
export type TaxOption = {
  id: string;
  label: string;
  rate: number;
  type: 'none' | 'slab' | 'custom' | 'group';
  components?: TaxComponent[];
  disabled?: boolean;
};

type RawTaxSettings = {
  enabledSlabs?: number[];
  enabled_slabs?: number[];
  customRates?: Array<{ id: string; name?: string; label?: string; rate: number; isActive?: boolean; active?: boolean }>;
  custom_rates?: Array<{ id: string; name?: string; label?: string; rate: number; isActive?: boolean; active?: boolean }>;
  taxGroups?: Array<{ id: string; name?: string; label?: string; totalRate?: number; total_rate?: number; rate?: number; components?: TaxComponent[]; isActive?: boolean; active?: boolean }>;
  tax_groups?: Array<{ id: string; name?: string; label?: string; totalRate?: number; total_rate?: number; rate?: number; components?: TaxComponent[]; isActive?: boolean; active?: boolean }>;
  groups?: Array<{ id: string; name?: string; label?: string; totalRate?: number; total_rate?: number; rate?: number; components?: TaxComponent[]; isActive?: boolean; active?: boolean }>;
};

function unwrap<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in body && (body as { data: unknown }).data !== undefined) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export function taxRateDisplay(rate: number) {
  return Number(rate).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export function buildTaxOptions(raw?: RawTaxSettings | null): TaxOption[] {
  const enabledSlabs = Array.isArray(raw?.enabledSlabs)
    ? raw!.enabledSlabs
    : Array.isArray(raw?.enabled_slabs)
      ? raw!.enabled_slabs
      : STANDARD_GST_SLABS;
  const enabledSlabSet = new Set(enabledSlabs.map((rate) => String(Number(rate))));
  const slabOptions: TaxOption[] = Array.from(new Set(enabledSlabs.map((rate) => Number(rate)).filter((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100)))
    .sort((a, b) => a - b)
    .map((rate) => ({
      id: `slab-${rate}`,
      label: `${taxRateDisplay(rate)}%`,
      rate,
      type: 'slab',
    }));

  const customRaw = Array.isArray(raw?.customRates) ? raw!.customRates : (Array.isArray(raw?.custom_rates) ? raw!.custom_rates : []);
  const customOptions: TaxOption[] = customRaw
    .filter((rate) => rate?.isActive !== false && rate?.active !== false)
    .map((rate) => ({
      id: String(rate.id),
      label: `${String(rate.name || rate.label || 'Custom Rate')} (${taxRateDisplay(Number(rate.rate) || 0)}%)`,
      rate: Number(rate.rate) || 0,
      type: 'custom' as const,
    }));

  const groupRaw = Array.isArray(raw?.taxGroups) ? raw!.taxGroups : (Array.isArray(raw?.tax_groups) ? raw!.tax_groups : (Array.isArray(raw?.groups) ? raw!.groups : []));
  const groupOptions: TaxOption[] = groupRaw
    .map((group) => {
      const components = Array.isArray(group.components) ? group.components : [];
      const totalRate = Number(group.totalRate ?? group.total_rate ?? group.rate ?? components.reduce((sum, part) => sum + Number(part.rate || 0), 0)) || 0;
      const name = String(group.name || group.label || `GST ${taxRateDisplay(totalRate)}%`);
      const isStandardGroup = String(group.id || '').startsWith('gst_') || /^GST@?\d/i.test(name);
      if (group?.isActive === false || group?.active === false) return null;
      if (isStandardGroup && !enabledSlabSet.has(String(totalRate))) return null;
      const componentLabel = components.length
        ? ` (${components.map((part) => `${String(part.type).toUpperCase()} ${taxRateDisplay(Number(part.rate) || 0)}%`).join(' + ')})`
        : ` (${taxRateDisplay(totalRate)}%)`;
      return {
        id: String(group.id),
        label: `${name}${componentLabel}`,
        rate: totalRate,
        type: 'group' as const,
        components,
      };
    })
    .filter(Boolean) as TaxOption[];

  const merged = [...slabOptions, ...customOptions, ...groupOptions]
    .filter((option) => Number.isFinite(option.rate) && option.rate >= 0 && option.rate <= 100)
    .sort((a, b) => a.rate - b.rate || a.label.localeCompare(b.label));
  return [{ id: 'none', label: 'None (0%)', rate: 0, type: 'none' }, ...merged.filter((option) => option.id !== 'none')];
}

export function taxOptionsFromCompany(company?: unknown): TaxOption[] {
  const settings = company && typeof company === 'object' && !Array.isArray(company)
    ? (company as { tax_settings?: RawTaxSettings }).tax_settings
    : undefined;
  return buildTaxOptions(settings);
}

export function useTaxOptions() {
  const query = useQuery({
    queryKey: ['settings', 'taxes'],
    queryFn: async () => {
      const response = await api.get('/settings/taxes');
      return unwrap<RawTaxSettings>(response.data);
    },
    staleTime: 60_000,
    retry: 1,
  });

  const options = useMemo(() => buildTaxOptions(query.data), [query.data]);
  const fallbackOptions = useMemo(() => buildTaxOptions(null), []);
  return {
    ...query,
    options: query.isError || options.length <= 1 ? fallbackOptions : options,
    usingFallback: query.isError || options.length <= 1,
  };
}
