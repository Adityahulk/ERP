import type { TaxOption } from '@/hooks/useTaxOptions';
import { taxRateDisplay } from '@/hooks/useTaxOptions';

type Props = {
  value: number;
  optionId?: string;
  options: TaxOption[];
  onChange: (next: { rate: number; optionId?: string; components?: TaxOption['components'] }) => void;
  className?: string;
};

function optionGroupLabel(type: TaxOption['type']) {
  if (type === 'none') return 'None';
  if (type === 'slab') return 'Standard Slabs';
  if (type === 'custom') return 'Custom Rates';
  return 'Tax Groups';
}

export default function TaxRateDropdown({ value, optionId, options, onChange, className }: Props) {
  const currentRate = Number(value) || 0;
  const selectedById = optionId ? options.find((option) => option.id === optionId) : undefined;
  const selectedByRate = options.find((option) => option.rate === currentRate && option.type !== 'group');
  const selected = selectedById || selectedByRate;
  const needsDisabledCurrent = !selected && currentRate > 0;
  const renderOptions = needsDisabledCurrent
    ? [{ id: `disabled-${currentRate}`, label: `(disabled) ${taxRateDisplay(currentRate)}%`, rate: currentRate, type: 'slab' as const, disabled: true }, ...options]
    : options;
  const valueKey = selected?.id || (needsDisabledCurrent ? `disabled-${currentRate}` : 'none');
  const groups: Array<TaxOption['type']> = ['none', 'slab', 'custom', 'group'];

  return (
    <select
      className={className}
      value={valueKey}
      title={needsDisabledCurrent ? 'This rate is disabled in Settings > Taxes & GST but is kept for this existing line.' : undefined}
      onChange={(event) => {
        const option = renderOptions.find((entry) => entry.id === event.target.value);
        if (!option) return;
        onChange({
          rate: option.rate,
          optionId: option.id.startsWith('disabled-') || option.id === 'none' ? undefined : option.id,
          components: option.components,
        });
      }}
    >
      {groups.map((group) => {
        const rows = renderOptions.filter((option) => option.type === group);
        if (!rows.length) return null;
        return (
          <optgroup key={group} label={optionGroupLabel(group)}>
            {rows.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
