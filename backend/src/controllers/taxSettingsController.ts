import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { query } from '../config/db';
import { error, success } from '../lib/response';

const STANDARD_GST_SLABS = [0, 0.1, 0.25, 0.5, 1, 1.5, 3, 5, 6, 7.5, 9, 12, 14, 18, 28, 40];
const COMPONENT_TYPES = new Set(['CGST', 'SGST', 'IGST', 'CESS', 'OTHER']);

type TaxComponent = { type: string; rate: number };
type CustomTaxRate = { id: string; name: string; rate: number; isActive: boolean };
type TaxGroup = { id: string; name: string; totalRate: number; components: TaxComponent[]; isActive: boolean };

function roundRate(value: unknown) {
  return Number((Number(value) || 0).toFixed(3));
}

function normalizeSlabs(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set(STANDARD_GST_SLABS.map((rate) => String(rate)));
  return Array.from(new Set(value.map(roundRate).filter((rate) => valid.has(String(rate)))))
    .sort((a, b) => a - b);
}

function normalizeCustomRates(value: unknown): CustomTaxRate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row: any) => ({
      id: String(row?.id || randomUUID()),
      name: String(row?.name || row?.label || '').trim().slice(0, 50),
      rate: Math.max(0.01, Math.min(100, roundRate(row?.rate))),
      isActive: row?.isActive !== false && row?.active !== false,
    }))
    .filter((row) => row.name);
}

function normalizeComponents(value: unknown): TaxComponent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((part: any) => {
      const type = String(part?.type || '').trim().toUpperCase();
      return {
        type: COMPONENT_TYPES.has(type) ? type : 'CGST',
        rate: Math.max(0, Math.min(100, roundRate(part?.rate))),
      };
    })
    .filter((part) => part.rate >= 0);
}

function normalizeTaxGroups(value: unknown): TaxGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row: any) => {
      const components = normalizeComponents(row?.components);
      const totalRate = components.length
        ? roundRate(components.reduce((sum, part) => sum + part.rate, 0))
        : Math.max(0, Math.min(100, roundRate(row?.totalRate ?? row?.total_rate ?? row?.rate)));
      const half = roundRate(totalRate / 2);
      return {
        id: String(row?.id || randomUUID()),
        name: String(row?.name || row?.label || `GST ${totalRate}%`).trim().slice(0, 50),
        totalRate,
        components: components.length ? components : [{ type: 'CGST', rate: half }, { type: 'SGST', rate: half }],
        isActive: row?.isActive !== false && row?.active !== false,
      };
    })
    .filter((row) => row.name);
}

function legacyRatesFromSlabs(enabledSlabs: number[]) {
  return enabledSlabs.flatMap((rate) => {
    const half = roundRate(rate / 2);
    return [
      { id: `igst_${rate}`, label: `IGST@${rate}%`, type: 'IGST', rate, active: true },
      { id: `sgst_${half}`, label: `SGST@${half}%`, type: 'SGST', rate: half, active: true },
      { id: `cgst_${half}`, label: `CGST@${half}%`, type: 'CGST', rate: half, active: true },
    ];
  });
}

function legacyGroupsFromTaxGroups(groups: TaxGroup[]) {
  return groups.map((group) => ({
    id: group.id,
    label: group.name,
    rate: group.totalRate,
    components: group.components,
    active: group.isActive,
  }));
}

function normalizeSettings(rawValue: unknown) {
  const raw = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) ? rawValue as any : {};
  const groups = normalizeTaxGroups(raw.taxGroups || raw.tax_groups || raw.groups);
  const enabledFromSlabs = normalizeSlabs(raw.enabledSlabs || raw.enabled_slabs);
  const enabledFromGroups = normalizeSlabs(groups.filter((group) => group.isActive).map((group) => group.totalRate));
  const enabledSlabs = enabledFromSlabs.length ? enabledFromSlabs : (enabledFromGroups.length ? enabledFromGroups : [...STANDARD_GST_SLABS]);
  const customRates = normalizeCustomRates(raw.customRates || raw.custom_rates);
  const normalizedGroups = groups.length
    ? groups
    : enabledSlabs.map((rate) => {
        const half = roundRate(rate / 2);
        return {
          id: `gst_${rate}`,
          name: `GST@${rate}%`,
          totalRate: rate,
          components: [{ type: 'SGST', rate: half }, { type: 'CGST', rate: half }],
          isActive: true,
        };
      });
  const enabledSet = new Set(enabledSlabs.map((rate) => String(rate)));
  const activeGroups = normalizedGroups.map((group) => {
    const isStandardGroup = group.id.startsWith('gst_') || /^GST@?\d/i.test(group.name);
    return isStandardGroup ? { ...group, isActive: enabledSet.has(String(group.totalRate)) } : group;
  });

  return {
    enable_gst: raw.enable_gst !== false,
    enable_hsn_sac: raw.enable_hsn_sac !== false,
    additional_cess_on_item: raw.additional_cess_on_item === true,
    reverse_charge: raw.reverse_charge === true,
    enable_place_of_supply: raw.enable_place_of_supply !== false,
    composite_scheme: raw.composite_scheme === true,
    enable_tcs: raw.enable_tcs === true,
    enable_tds: raw.enable_tds === true,
    enabledSlabs,
    customRates,
    taxGroups: activeGroups,
    rates: Array.isArray(raw.rates) && raw.rates.length ? raw.rates : legacyRatesFromSlabs(enabledSlabs),
    groups: legacyGroupsFromTaxGroups(activeGroups),
  };
}

async function readCompanyTaxSettings(companyId: string) {
  const result = await query('SELECT tax_settings FROM companies WHERE id = $1 AND is_deleted = false', [companyId]);
  if (!result.rows.length) throw new Error('Company not found');
  return normalizeSettings(result.rows[0].tax_settings);
}

async function writeCompanyTaxSettings(companyId: string, settings: ReturnType<typeof normalizeSettings>) {
  const payload = {
    ...settings,
    enabled_slabs: settings.enabledSlabs,
    custom_rates: settings.customRates,
    tax_groups: settings.taxGroups,
    rates: legacyRatesFromSlabs(settings.enabledSlabs),
    groups: legacyGroupsFromTaxGroups(settings.taxGroups),
  };
  await query('UPDATE companies SET tax_settings = $1::jsonb, updated_at = NOW() WHERE id = $2', [JSON.stringify(payload), companyId]);
  return normalizeSettings(payload);
}

export async function getTaxSettings(req: Request, res: Response) {
  try {
    const settings = await readCompanyTaxSettings(req.user!.company_id);
    res.json(success({
      enabledSlabs: settings.enabledSlabs,
      customRates: settings.customRates,
      taxGroups: settings.taxGroups,
    }));
  } catch (err: any) {
    res.status(err.message === 'Company not found' ? 404 : 500).json(error(err.message));
  }
}

export async function updateTaxSlabs(req: Request, res: Response) {
  try {
    const enabledSlabs = normalizeSlabs(req.body?.enabledSlabs ?? req.body?.enabled_slabs);
    if (!enabledSlabs.length) return res.status(400).json(error('Select at least one valid GST slab.'));
    const settings = await readCompanyTaxSettings(req.user!.company_id);
    settings.enabledSlabs = enabledSlabs;
    settings.taxGroups = settings.taxGroups.map((group) => {
      const isStandardGroup = group.id.startsWith('gst_') || /^GST@?\d/i.test(group.name);
      return isStandardGroup ? { ...group, isActive: enabledSlabs.includes(group.totalRate) } : group;
    });
    res.json(success(await writeCompanyTaxSettings(req.user!.company_id, settings)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function createCustomTaxRate(req: Request, res: Response) {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 50);
    const rate = roundRate(req.body?.rate);
    if (!name) return res.status(400).json(error('Custom tax rate name is required.'));
    if (rate < 0.01 || rate > 100) return res.status(400).json(error('Custom tax rate must be between 0.01 and 100.'));
    const settings = await readCompanyTaxSettings(req.user!.company_id);
    settings.customRates.push({ id: randomUUID(), name, rate, isActive: true });
    res.status(201).json(success(await writeCompanyTaxSettings(req.user!.company_id, settings)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function updateCustomTaxRate(req: Request, res: Response) {
  try {
    const settings = await readCompanyTaxSettings(req.user!.company_id);
    const id = String(req.params.id);
    const idx = settings.customRates.findIndex((row) => row.id === id);
    if (idx < 0) return res.status(404).json(error('Custom tax rate not found.'));
    const current = settings.customRates[idx];
    const nextRate = req.body?.rate === undefined ? current.rate : roundRate(req.body.rate);
    if (nextRate < 0.01 || nextRate > 100) return res.status(400).json(error('Custom tax rate must be between 0.01 and 100.'));
    settings.customRates[idx] = {
      ...current,
      name: req.body?.name === undefined ? current.name : String(req.body.name || '').trim().slice(0, 50),
      rate: nextRate,
      isActive: req.body?.isActive === undefined ? current.isActive : req.body.isActive !== false,
    };
    if (!settings.customRates[idx].name) return res.status(400).json(error('Custom tax rate name is required.'));
    res.json(success(await writeCompanyTaxSettings(req.user!.company_id, settings)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function deleteCustomTaxRate(req: Request, res: Response) {
  try {
    const settings = await readCompanyTaxSettings(req.user!.company_id);
    settings.customRates = settings.customRates.map((row) => row.id === req.params.id ? { ...row, isActive: false } : row);
    res.json(success(await writeCompanyTaxSettings(req.user!.company_id, settings)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

function buildTaxGroupFromBody(body: any, existing?: TaxGroup): TaxGroup | string {
  const name = body?.name === undefined ? existing?.name || '' : String(body.name || '').trim().slice(0, 50);
  const components = body?.components === undefined ? existing?.components || [] : normalizeComponents(body.components);
  const totalRate = roundRate(components.reduce((sum, part) => sum + part.rate, 0));
  if (!name) return 'Tax group name is required.';
  if (!components.length) return 'Add at least one tax component.';
  if (totalRate > 100) return 'Tax group total rate cannot exceed 100%.';
  return {
    id: existing?.id || randomUUID(),
    name,
    totalRate,
    components,
    isActive: body?.isActive === undefined ? existing?.isActive !== false : body.isActive !== false,
  };
}

export async function createTaxGroup(req: Request, res: Response) {
  try {
    const group = buildTaxGroupFromBody(req.body);
    if (typeof group === 'string') return res.status(400).json(error(group));
    const settings = await readCompanyTaxSettings(req.user!.company_id);
    settings.taxGroups.push(group);
    res.status(201).json(success(await writeCompanyTaxSettings(req.user!.company_id, settings)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function updateTaxGroup(req: Request, res: Response) {
  try {
    const settings = await readCompanyTaxSettings(req.user!.company_id);
    const idx = settings.taxGroups.findIndex((row) => row.id === req.params.id);
    if (idx < 0) return res.status(404).json(error('Tax group not found.'));
    const group = buildTaxGroupFromBody(req.body, settings.taxGroups[idx]);
    if (typeof group === 'string') return res.status(400).json(error(group));
    settings.taxGroups[idx] = group;
    res.json(success(await writeCompanyTaxSettings(req.user!.company_id, settings)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function deleteTaxGroup(req: Request, res: Response) {
  try {
    const settings = await readCompanyTaxSettings(req.user!.company_id);
    settings.taxGroups = settings.taxGroups.map((row) => row.id === req.params.id ? { ...row, isActive: false } : row);
    res.json(success(await writeCompanyTaxSettings(req.user!.company_id, settings)));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
