import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export type PrintLayoutId =
  | 'business-theme-1'
  | 'business-theme-2'
  | 'business-theme-3'
  | 'business-theme-4'
  | 'tally-theme-1'
  | 'landscape-theme-1'
  | 'landscape-theme-2'
  | 'gst-theme-1'
  | 'gst-theme-2'
  | 'gst-theme-3'
  | 'gst-theme-4'
  | 'gst-theme-5'
  | 'reference-tax-eway-theme';

export type PrintLayoutGroup = 'Business' | 'Landscape' | 'GST Style' | 'Tally Style' | 'Reference';

export type PrintLayoutOption = {
  id: PrintLayoutId;
  label: string;
  group: PrintLayoutGroup;
  orientation: 'portrait' | 'landscape';
};

export const PRINT_COLOR_PALETTE = [
  { name: 'Purple', value: '#7C3AED' },
  { name: 'Blue', value: '#2563EB' },
  { name: 'Teal', value: '#0D9488' },
  { name: 'Green', value: '#16A34A' },
  { name: 'Orange', value: '#EA580C' },
  { name: 'Red', value: '#DC2626' },
  { name: 'Black', value: '#111827' },
  { name: 'Gray', value: '#6B7280' },
  { name: 'Navy', value: '#1E3A8A' },
  { name: 'Dark Green', value: '#14532D' },
] as const;

export const PRINT_LAYOUT_OPTIONS: PrintLayoutOption[] = [
  { id: 'business-theme-1', label: 'Business Theme 1', group: 'Business', orientation: 'portrait' },
  { id: 'business-theme-2', label: 'Business Theme 2', group: 'Business', orientation: 'portrait' },
  { id: 'business-theme-3', label: 'Business Theme 3', group: 'Business', orientation: 'portrait' },
  { id: 'business-theme-4', label: 'Business Theme 4', group: 'Business', orientation: 'portrait' },
  { id: 'landscape-theme-1', label: 'Landscape Theme 1', group: 'Landscape', orientation: 'landscape' },
  { id: 'landscape-theme-2', label: 'Landscape Theme 2', group: 'Landscape', orientation: 'landscape' },
  { id: 'gst-theme-1', label: 'GST Theme 1', group: 'GST Style', orientation: 'portrait' },
  { id: 'gst-theme-2', label: 'GST Theme 2', group: 'GST Style', orientation: 'portrait' },
  { id: 'gst-theme-3', label: 'GST Theme 3', group: 'GST Style', orientation: 'portrait' },
  { id: 'gst-theme-4', label: 'GST Theme 4', group: 'GST Style', orientation: 'portrait' },
  { id: 'gst-theme-5', label: 'GST Theme 5', group: 'GST Style', orientation: 'portrait' },
  { id: 'tally-theme-1', label: 'Tally Theme', group: 'Tally Style', orientation: 'portrait' },
  { id: 'reference-tax-eway-theme', label: 'Reference Tax + E-Way Theme', group: 'Reference', orientation: 'portrait' },
];

export const PRINT_LAYOUT_BY_ID = Object.fromEntries(PRINT_LAYOUT_OPTIONS.map((layout) => [layout.id, layout])) as Record<PrintLayoutId, PrintLayoutOption>;

export const PRINT_LAYOUT_LEGACY_ID_MAP: Record<string, PrintLayoutId> = {
  standard: 'business-theme-1',
  'detailed-tax-invoice': 'business-theme-1',
  simple: 'business-theme-2',
  'professional-header': 'business-theme-2',
  performa: 'business-theme-3',
  'centered-proforma': 'business-theme-3',
  monochrome: 'business-theme-4',
  'black-white-standard': 'business-theme-4',
  classic: 'business-theme-1',
  modern: 'business-theme-1',
  compact: 'business-theme-1',
  executive: 'business-theme-1',
  sunrise: 'business-theme-1',
  forest: 'business-theme-1',
  midnight: 'business-theme-1',
  royal: 'business-theme-1',
  slate: 'business-theme-1',
  retail: 'business-theme-1',
  minimal: 'business-theme-1',
  micro_theme_1: 'gst-theme-1',
  micro_theme_2: 'gst-theme-2',
  micro_theme_3: 'gst-theme-3',
  micro_theme_4: 'gst-theme-4',
  micro_theme_5: 'gst-theme-5',
  landscape_theme_1: 'landscape-theme-1',
  landscape_theme_2: 'landscape-theme-2',
  gst_theme_1: 'gst-theme-1',
  gst_theme_2: 'gst-theme-2',
  gst_theme_3: 'gst-theme-3',
  gst_theme_4: 'gst-theme-4',
  gst_theme_5: 'gst-theme-5',
  gst_theme_6: 'gst-theme-5',
  gst_theme_7: 'gst-theme-5',
  gst_theme_8: 'gst-theme-5',
  gst_theme_9: 'gst-theme-5',
  gst_theme_10: 'tally-theme-1',
  delivery_theme: 'tally-theme-1',
  double_divine: 'tally-theme-1',
  reference_tax_eway_theme: 'reference-tax-eway-theme',
  reference_tax_invoice: 'reference-tax-eway-theme',
};

export const DEFAULT_PRINT_LAYOUT_COLORS = Object.fromEntries(PRINT_LAYOUT_OPTIONS.map((layout) => [layout.id, '#7C3AED']));

const PRINT_LAYOUT_GROUPS: PrintLayoutGroup[] = ['Business', 'Landscape', 'GST Style', 'Tally Style', 'Reference'];

type PreviewColumn = { key: string; label: string };

export type PrintPreviewData = {
  firm: {
    name: string;
    address: string;
    phone: string;
    email: string;
    gstin: string;
    state: string;
    logo?: string;
    signature?: string;
  };
  invoice: {
    number: string;
    date: string;
    time: string;
    dueDate: string;
    type: string;
  };
  billTo: { name: string; address: string; contact: string };
  shipTo: { name: string; address: string };
  footer: {
    description: string;
    termsAndConditions: string;
    bankName: string;
    bankAccount: string;
    bankIfsc: string;
    authorizedSignature: string;
    showQR: boolean;
  };
};

type PreviewProps = {
  layoutId: string;
  accentColor: string;
  columns: PreviewColumn[];
  getCellValue: (key: string, row: 1 | 2) => string;
  data: PrintPreviewData;
  amountInWords: string;
  showDescription: boolean;
  showTerms: boolean;
  showReceived: boolean;
  showBalance: boolean;
  showYouSaved: boolean;
  showTaxDetails: boolean;
  showPaymentMode: boolean;
  showAcknowledgement: boolean;
  showReceivedBy: boolean;
  showDeliveredBy: boolean;
  showSignature: boolean;
};

type PickerProps = {
  value: string;
  onChange: (layoutId: PrintLayoutId) => void;
};

function normalizedLayoutId(id: string): PrintLayoutId {
  return (PRINT_LAYOUT_BY_ID[id as PrintLayoutId] ? id : PRINT_LAYOUT_LEGACY_ID_MAP[id] || 'business-theme-1') as PrintLayoutId;
}

export function getPrintLayoutLabel(id: string) {
  return PRINT_LAYOUT_BY_ID[normalizedLayoutId(id)].label;
}

function LayoutThumbnail({ layoutId }: { layoutId: PrintLayoutId }) {
  const landscape = PRINT_LAYOUT_BY_ID[layoutId].orientation === 'landscape';
  const layoutClass = {
    'business-theme-1': 'grid-rows-[12px_14px_1fr_18px]',
    'business-theme-2': 'grid-rows-[16px_12px_1fr_14px]',
    'business-theme-3': 'grid-rows-[10px_18px_1fr_16px]',
    'business-theme-4': 'grid-rows-[12px_12px_1fr_18px]',
    'tally-theme-1': 'grid-rows-[8px_12px_14px_1fr_18px]',
    'landscape-theme-1': 'grid-rows-[8px_14px_14px_1fr_10px_12px]',
    'landscape-theme-2': 'grid-rows-[8px_14px_14px_1fr_24px]',
    'gst-theme-1': 'grid-rows-[14px_8px_14px_1fr_20px]',
    'gst-theme-2': 'grid-rows-[10px_16px_1fr_16px_14px]',
    'gst-theme-3': 'grid-rows-[18px_14px_1fr_18px]',
    'gst-theme-4': 'grid-rows-[16px_8px_1fr_18px]',
    'gst-theme-5': 'grid-rows-[10px_1fr_14px_12px]',
    'reference-tax-eway-theme': 'grid-rows-[8px_14px_16px_1fr_10px_16px]',
  }[layoutId];
  return (
    <div className={`grid shrink-0 gap-[3px] rounded border border-[#333] bg-white p-1 ${landscape ? 'h-[60px] w-20' : 'h-[60px] w-12'} ${layoutClass}`}>
      <div className="bg-[#ccc]" />
      <div className="grid grid-cols-2 gap-[3px]">
        <span className="bg-[#eee]" />
        <span className="bg-[#eee]" />
      </div>
      <div className="bg-[#888]" />
      <div className="grid grid-cols-4 gap-[2px] border border-[#333] p-[2px]">
        <span className="bg-[#ccc]" />
        <span className="bg-[#ccc]" />
        <span className="bg-[#ccc]" />
        <span className="bg-[#ccc]" />
      </div>
      <div className="grid grid-cols-3 gap-[3px]">
        <span className="bg-[#eee]" />
        <span className="bg-[#eee]" />
        <span className="bg-[#eee]" />
      </div>
    </div>
  );
}

export function PrintLayoutPicker({ value, onChange }: PickerProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const current = normalizedLayoutId(value);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((state) => !state)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border bg-white px-4 py-3 text-left shadow-sm transition hover:border-indigo-300 hover:bg-slate-50"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700">
          <span className="text-base">↗</span>
          <span>Select Layout</span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-900">
          <span className="truncate">{PRINT_LAYOUT_BY_ID[current].label}</span>
          <span className="text-slate-500">⌄</span>
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-[min(400px,calc(100vw-48px))] overflow-hidden rounded-xl border bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="font-bold text-slate-900">Select Invoice Layout</h3>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 text-slate-500 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[70vh] space-y-5 overflow-y-auto p-3">
            {PRINT_LAYOUT_GROUPS.map((group) => (
              <section key={group} className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-slate-400">
                  <span>{group}</span>
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
                {PRINT_LAYOUT_OPTIONS.filter((layout) => layout.group === group).map((layout) => {
                  const selected = layout.id === current;
                  return (
                    <button
                      key={layout.id}
                      type="button"
                      onClick={() => {
                        onChange(layout.id);
                        localStorage.setItem('print_layout_id', layout.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition hover:bg-slate-50 ${selected ? 'border-blue-200 bg-blue-50 shadow-sm' : 'border-transparent'}`}
                      style={{ borderLeftWidth: selected ? 4 : 1 }}
                    >
                      <LayoutThumbnail layoutId={layout.id} />
                      <span className="min-w-0 flex-1 text-sm font-semibold text-slate-800">{layout.label}</span>
                      {selected && <span className="text-sm font-bold text-blue-700">✓</span>}
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemsTable({ columns, getCellValue, dense = false }: Pick<PreviewProps, 'columns' | 'getCellValue'> & { dense?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className={`min-w-full border-collapse ${dense ? 'text-[8px]' : 'text-[9px]'}`}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="border border-slate-500 bg-[var(--accent-color)] px-1 py-1 text-left font-bold text-white">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[1, 2].map((row) => (
            <tr key={row} className={row === 2 ? 'bg-slate-50' : ''}>
              {columns.map((col) => (
                <td key={col.key} className="border border-slate-400 px-1 py-1">{getCellValue(col.key, row as 1 | 2)}</td>
              ))}
            </tr>
          ))}
          <tr className="font-bold">
            {columns.map((col, index) => (
              <td key={col.key} className="border border-slate-500 px-1 py-1">{index === 1 ? 'TOTAL' : ['quantity', 'tax_amount', 'amount'].includes(col.key) ? getCellValue(col.key, 1) : ''}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Header({ data, compact = false }: { data: PrintPreviewData; compact?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 ${compact ? 'text-[8px]' : 'text-[9px]'}`}>
      <div className="flex min-w-0 gap-2">
        {data.firm.logo ? <img src={data.firm.logo} alt="Logo" className="h-8 w-12 object-contain" /> : <div className="h-8 w-12 border bg-slate-100" />}
        <div className="min-w-0">
          <h2 className={`${compact ? 'text-[12px]' : 'text-sm'} break-words font-bold`}>{data.firm.name}</h2>
          <p>{data.firm.address}</p>
          <p>Phone: {data.firm.phone} · GSTIN: {data.firm.gstin}</p>
          <p>Email: {data.firm.email} · State: {data.firm.state}</p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <b>Invoice Details</b>
        <p>No.: {data.invoice.number}</p>
        <p>Date: {data.invoice.date}</p>
        <p>Time: {data.invoice.time}</p>
        <p>Due: {data.invoice.dueDate}</p>
      </div>
    </div>
  );
}

function PartyBlocks({ data, three = false }: { data: PrintPreviewData; three?: boolean }) {
  return (
    <div className={`grid gap-2 text-[9px] ${three ? 'grid-cols-3' : 'grid-cols-2'}`}>
      <div className="border p-2">
        <b>Bill To:</b>
        <p className="font-semibold">{data.billTo.name}</p>
        <p>{data.billTo.address}</p>
        <p>{data.billTo.contact}</p>
      </div>
      <div className="border p-2">
        <b>Ship To:</b>
        <p className="font-semibold">{data.shipTo.name}</p>
        <p>{data.shipTo.address}</p>
      </div>
      {three && (
        <div className="border p-2 text-right">
          <b>Invoice Details</b>
          <p>No.: {data.invoice.number}</p>
          <p>Date: {data.invoice.date}</p>
          <p>Time: {data.invoice.time}</p>
          <p>Due: {data.invoice.dueDate}</p>
        </div>
      )}
    </div>
  );
}

function TaxSummary() {
  return (
    <table className="w-full border-collapse text-[8px]">
      <thead><tr><th className="border p-1">HSN/SAC</th><th className="border p-1">Taxable</th><th className="border p-1">CGST%</th><th className="border p-1">CGST</th><th className="border p-1">SGST%</th><th className="border p-1">SGST</th><th className="border p-1">Total Tax</th></tr></thead>
      <tbody>
        <tr><td className="border p-1">9983</td><td className="border p-1">475.00</td><td className="border p-1">9%</td><td className="border p-1">42.75</td><td className="border p-1">9%</td><td className="border p-1">42.75</td><td className="border p-1">85.50</td></tr>
        <tr><td className="border p-1">9985</td><td className="border p-1">700.00</td><td className="border p-1">9%</td><td className="border p-1">63.00</td><td className="border p-1">9%</td><td className="border p-1">63.00</td><td className="border p-1">126.00</td></tr>
        <tr className="font-bold"><td className="border p-1">Total</td><td className="border p-1">1175.00</td><td className="border p-1" /><td className="border p-1">105.75</td><td className="border p-1" /><td className="border p-1">105.75</td><td className="border p-1">211.50</td></tr>
      </tbody>
    </table>
  );
}

function Totals({ props, compact = false }: { props: PreviewProps; compact?: boolean }) {
  return (
    <div className={`${compact ? 'text-[8px]' : 'text-[9px]'} space-y-1`}>
      <div className="flex justify-between"><span>Sub Total</span><b>₹1,175.00</b></div>
      <div className="flex justify-between"><span>Discount</span><b>₹25.00</b></div>
      {props.showTaxDetails && <div className="flex justify-between"><span>Tax</span><b>₹211.50</b></div>}
      <div className="flex justify-between bg-[var(--accent-color)] px-2 py-1 font-bold text-white"><span>Total</span><span>₹1,386.50</span></div>
      {props.showReceived && <div className="flex justify-between"><span>Received</span><b>₹500.00</b></div>}
      {props.showBalance && <div className="flex justify-between"><span>Balance</span><b>₹886.50</b></div>}
      {props.showYouSaved && <div className="flex justify-between"><span>You Saved</span><b>₹25.00</b></div>}
    </div>
  );
}

function BankSignature({ props, cols = 'grid-cols-2' }: { props: PreviewProps; cols?: string }) {
  return (
    <div className={`grid gap-2 border-t pt-2 text-[8px] ${cols}`}>
      <div>
        {props.data.footer.showQR && <div className="mb-1 h-10 w-10 border bg-slate-100 text-center text-[7px] leading-10">QR</div>}
        <b>Bank Details</b>
        <p>{props.data.footer.bankName}</p>
        <p>A/c: {props.data.footer.bankAccount}</p>
        <p>IFSC: {props.data.footer.bankIfsc}</p>
        {props.showPaymentMode && <p>Payment Mode: Bank Transfer</p>}
      </div>
      <div className="text-right">
        <p>For: {props.data.firm.name}</p>
        {props.showSignature && (props.data.firm.signature ? <img src={props.data.firm.signature} alt="Signature" className="ml-auto h-9 object-contain" /> : <div className="ml-auto h-9 w-24 bg-slate-100" />)}
        <b>{props.data.footer.authorizedSignature}</b>
      </div>
    </div>
  );
}

function Notes({ props }: { props: PreviewProps }) {
  return (
    <div className="space-y-2 text-[8px]">
      {props.showDescription && <div><b>Description</b><p>{props.data.footer.description}</p></div>}
      <div><b>Invoice Amount in Words</b><p>{props.amountInWords}</p></div>
      {props.showTerms && <div><b>Terms & Conditions</b><p>{props.data.footer.termsAndConditions}</p></div>}
      {props.showReceivedBy && <p>Received By: __________</p>}
      {props.showDeliveredBy && <p>Delivered By: __________</p>}
      {props.showAcknowledgement && <p>Acknowledgement: Received in good condition</p>}
    </div>
  );
}

function TallyTheme(props: PreviewProps) {
  return (
    <div className="space-y-0 border border-slate-700 font-serif text-[8px]">
      <h1 className="border-b border-slate-700 py-2 text-center text-base font-bold">{props.data.invoice.type}</h1>
      <div className="border-b border-slate-700 p-2"><Header data={props.data} /></div>
      <PartyBlocks data={props.data} />
      <div className="border-b border-slate-700 p-2"><b>Ship To:</b> {props.data.shipTo.address}</div>
      <ItemsTable columns={props.columns} getCellValue={props.getCellValue} dense />
      <div className="grid grid-cols-[1.45fr_0.75fr] border-t border-slate-700">
        <div className="border-r border-slate-700 p-2"><TaxSummary /></div>
        <div className="p-2"><Totals props={props} compact /><Notes props={props} /></div>
      </div>
      <div className="grid grid-cols-2 border-t border-slate-700 p-2"><Notes props={props} /><BankSignature props={props} /></div>
    </div>
  );
}

function LandscapeTheme1(props: PreviewProps) {
  return (
    <div className="space-y-2 text-[8px]">
      <h1 className="border-b pb-1 text-center text-sm font-bold">{props.data.invoice.type}</h1>
      <Header data={props.data} compact />
      <PartyBlocks data={props.data} />
      <ItemsTable columns={props.columns} getCellValue={props.getCellValue} dense />
      <div className="flex flex-wrap gap-2 border p-2 text-[8px]"><b>Sub Total: ₹1,175.00</b><span>Discount: ₹25.00</span><span>Tax: ₹211.50</span><span>TCS: ₹0.00</span><b>Total: ₹1,386.50</b><span>{props.amountInWords}</span></div>
      <div className="flex flex-wrap gap-4 border p-2 text-[8px]">{props.showReceived && <span>Received: ₹500.00</span>}{props.showBalance && <span>Balance: ₹886.50</span>}<span>Current Balance: ₹1,24,097.11</span>{props.showYouSaved && <span>You Saved: ₹25.00</span>}</div>
      <div className="grid grid-cols-2 gap-2"><TaxSummary /><BankSignature props={props} /></div>
      <div className="grid grid-cols-3 gap-2 border p-2"><Notes props={props} /><div>{props.showTerms && props.data.footer.termsAndConditions}</div><BankSignature props={props} /></div>
    </div>
  );
}

function LandscapeTheme2(props: PreviewProps) {
  return (
    <div className="space-y-2 text-[8px]">
      <h1 className="border-b pb-1 text-center text-sm font-bold">{props.data.invoice.type}</h1>
      <Header data={props.data} compact />
      <PartyBlocks data={props.data} />
      <ItemsTable columns={props.columns} getCellValue={props.getCellValue} dense />
      <div className="grid grid-cols-[1.4fr_0.8fr] gap-2 border p-2"><TaxSummary /><Totals props={props} compact /></div>
      <div className="grid grid-cols-4 gap-2 border p-2"><Notes props={props} /><div>{props.data.footer.termsAndConditions}</div><div>{props.data.footer.bankName}<br />{props.data.footer.bankAccount}</div><BankSignature props={props} /></div>
    </div>
  );
}

function GstTheme1(props: PreviewProps) {
  return (
    <div className="space-y-3 text-[9px]">
      <Header data={props.data} />
      <h1 className="border-y py-2 text-center text-xl font-bold text-[var(--accent-color)]">{props.data.invoice.type}</h1>
      <PartyBlocks data={props.data} three />
      <ItemsTable columns={props.columns} getCellValue={props.getCellValue} />
      <div className="grid grid-cols-[1fr_230px] gap-4"><Notes props={props} /><Totals props={props} /></div>
      <BankSignature props={props} />
    </div>
  );
}

function GstTheme2(props: PreviewProps) {
  return (
    <div className="space-y-3 text-[9px]">
      <div className="grid grid-cols-[80px_1fr_150px] items-center border p-2"><div>{props.data.firm.logo ? <img src={props.data.firm.logo} alt="Logo" /> : 'Logo'}</div><h2 className="text-center text-base font-bold">{props.data.firm.name}</h2><div className="text-right">{props.data.firm.gstin}</div></div>
      <PartyBlocks data={props.data} three />
      <ItemsTable columns={props.columns} getCellValue={props.getCellValue} />
      <div className="grid grid-cols-[1fr_210px] gap-3"><TaxSummary /><Totals props={props} /></div>
      <Notes props={props} />
      <BankSignature props={props} />
    </div>
  );
}

function GstTheme3(props: PreviewProps) {
  return (
    <div className="space-y-3 text-[9px]">
      <div className="grid grid-cols-[1fr_190px] gap-3"><Header data={props.data} /><div className="border p-2 text-right"><b>{props.data.invoice.type}</b><p>{props.data.invoice.number}</p><p>{props.data.invoice.date}</p></div></div>
      <div className="border p-2"><b>Bill To:</b> {props.data.billTo.name}, {props.data.billTo.address}</div>
      <ItemsTable columns={props.columns} getCellValue={props.getCellValue} />
      <div className="grid grid-cols-[1fr_200px] gap-3"><TaxSummary /><Totals props={props} /></div>
      <BankSignature props={props} />
    </div>
  );
}

function GstTheme4(props: PreviewProps) {
  return (
    <div className="space-y-3 text-[9px]">
      <div className="flex justify-between border-b pb-2"><div><h2 className="text-xl font-bold">{props.data.firm.name}</h2><p>{props.data.firm.address}</p></div><div className="text-right"><b>{props.data.invoice.type}</b><p>{props.data.invoice.number}</p><p>{props.data.invoice.date}</p></div></div>
      <PartyBlocks data={props.data} />
      <ItemsTable columns={props.columns} getCellValue={props.getCellValue} />
      <div className="ml-auto w-56"><Totals props={props} /></div>
      <div className="grid grid-cols-3 gap-3 border-t pt-2"><Notes props={props} /><div>{props.data.footer.termsAndConditions}</div><BankSignature props={props} /></div>
    </div>
  );
}

function GstTheme5(props: PreviewProps) {
  return (
    <div className="space-y-2 text-[8px]">
      <div className="flex items-center justify-between gap-2 border p-1"><b>{props.data.firm.name}</b><span>{props.data.firm.gstin}</span><span>{props.data.firm.phone}</span></div>
      <PartyBlocks data={props.data} three />
      <ItemsTable columns={props.columns} getCellValue={props.getCellValue} dense />
      <div className="ml-auto w-48"><Totals props={props} compact /></div>
      <div className="grid grid-cols-3 gap-2 border-t pt-2"><div>{props.data.footer.bankName}<br />{props.data.footer.bankAccount}</div><Notes props={props} /><BankSignature props={props} /></div>
    </div>
  );
}

const LAYOUT_COMPONENTS: Record<PrintLayoutId, (props: PreviewProps) => JSX.Element> = {
  'business-theme-1': GstTheme1,
  'business-theme-2': GstTheme2,
  'business-theme-3': GstTheme3,
  'business-theme-4': TallyTheme,
  'tally-theme-1': TallyTheme,
  'landscape-theme-1': LandscapeTheme1,
  'landscape-theme-2': LandscapeTheme2,
  'gst-theme-1': GstTheme1,
  'gst-theme-2': GstTheme2,
  'gst-theme-3': GstTheme3,
  'gst-theme-4': GstTheme4,
  'gst-theme-5': GstTheme5,
  'reference-tax-eway-theme': TallyTheme,
};

export function PrintInvoiceLayoutPreview(props: PreviewProps) {
  const layoutId = normalizedLayoutId(props.layoutId);
  const Layout = LAYOUT_COMPONENTS[layoutId];
  const landscape = PRINT_LAYOUT_BY_ID[layoutId].orientation === 'landscape';
  return (
    <div className="overflow-auto rounded-lg border bg-slate-200 p-4 shadow-inner">
      <div
        className="mx-auto origin-top overflow-hidden rounded-sm bg-white p-4 shadow-lg"
        style={{
          width: landscape ? '297mm' : '210mm',
          minHeight: landscape ? '210mm' : '297mm',
          maxWidth: '100%',
          ['--accent-color' as string]: props.accentColor,
          ['--font-family' as string]: 'Inter, system-ui, sans-serif',
        }}
      >
        <Layout {...props} />
      </div>
    </div>
  );
}
