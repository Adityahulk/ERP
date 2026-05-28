export type ItemCustomFieldDef = {
  id: string;
  key?: string;
  label: string;
  type: 'text' | 'number' | 'date';
  enabled: boolean;
  show_in_print?: boolean;
};

export function normalizeFieldId(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

export function normalizeItemCustomFields(value: unknown): ItemCustomFieldDef[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row: any, index) => {
      const label = String(row?.label || row?.key || row?.id || '').trim();
      const id = normalizeFieldId(String(row?.id || row?.key || label || `item_custom_${index + 1}`));
      return {
        id,
        key: id,
        label,
        type: (['number', 'date'].includes(String(row?.type)) ? row.type : 'text') as ItemCustomFieldDef['type'],
        enabled: Boolean(row?.enabled),
        show_in_print: Boolean(row?.show_in_print),
      };
    })
    .filter((row) => row.id && row.label);
}

export function enabledItemCustomFields(value: unknown) {
  return normalizeItemCustomFields(value).filter((field) => field.enabled);
}

