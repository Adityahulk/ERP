import { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Download, Filter, FileText, ChevronDown } from 'lucide-react';
import { formatMoney, formatDate } from '@/lib/formatters';
import { downloadCsv, downloadXlsx, keyValueRows } from '@/lib/reportExport';
import toast from 'react-hot-toast';

type ReportName =
  | 'GSTR-1 Data'
  | 'GSTR-3B Summary'
  | 'HSN Summary'
  | 'Input Tax Credit'
  | 'GST Out/In summary'
  | 'Sales Register'
  | 'E-Invoice Register'
  | 'Item-wise Sales'
  | 'Party-wise Sales'
  | 'Outstanding Receivables'
  | 'Purchase Register'
  | 'Party-wise Purchase'
  | 'Outstanding Payables'
  | 'Stock Summary'
  | 'Stock Movement'
  | 'Low Stock Alert'
  | 'Profit & Loss'
  | 'Balance Sheet'
  | 'Trial Balance'
  | 'Day Book'
  | 'Expense Summary'
  | 'Payment Collection'
  | 'TCS / TDS';

const reportCategories = [
  { id: 'gst', title: 'GST Reports', reports: ['GSTR-1 Data', 'GSTR-3B Summary', 'HSN Summary', 'Input Tax Credit', 'GST Out/In summary'] as const },
  { id: 'sales', title: 'Sales Reports', reports: ['Sales Register', 'E-Invoice Register', 'Item-wise Sales', 'Party-wise Sales', 'Outstanding Receivables'] as const },
  { id: 'purchase', title: 'Purchase Reports', reports: ['Purchase Register', 'Party-wise Purchase', 'Outstanding Payables'] as const },
  { id: 'inventory', title: 'Inventory Reports', reports: ['Stock Summary', 'Stock Movement', 'Low Stock Alert'] as const },
  { id: 'financial', title: 'Financial Reports', reports: ['Profit & Loss', 'Balance Sheet', 'Trial Balance', 'Day Book', 'Expense Summary', 'Payment Collection', 'TCS / TDS'] as const },
];

function monthYearFromDate(isoDate: string): { month: string; year: string } {
  const d = new Date(isoDate + 'T12:00:00');
  return { month: String(d.getMonth() + 1).padStart(2, '0'), year: String(d.getFullYear()) };
}

function defaultDates() {
  const to = new Date().toISOString().split('T')[0];
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  return { from, to };
}

function unwrap<T>(res: { data?: { data?: T; success?: boolean } }): T {
  const d = res.data as { data?: T } | undefined;
  return (d?.data ?? res.data) as T;
}

export default function ReportsHome() {
  const { from: defaultFrom, to: defaultTo } = defaultDates();
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [appliedFrom, setAppliedFrom] = useState(defaultFrom);
  const [appliedTo, setAppliedTo] = useState(defaultTo);
  const [activeReport, setActiveReport] = useState<ReportName>('Sales Register');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const applyFilters = () => {
    if (!fromDate || !toDate) {
      toast.error('Choose from and to dates');
      return;
    }
    if (fromDate > toDate) {
      toast.error('From date must be on or before to date');
      return;
    }
    setAppliedFrom(fromDate);
    setAppliedTo(toDate);
    setFiltersOpen(false);
    toast.success('Filters applied');
  };

  const { month, year } = monthYearFromDate(appliedFrom);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['business-report', activeReport, appliedFrom, appliedTo, month, year],
    queryFn: async () => {
      const params = { from_date: appliedFrom, to_date: appliedTo };
      switch (activeReport) {
        case 'Sales Register':
          return unwrap(await api.get('/reports/sales-register', { params }));
        case 'E-Invoice Register':
          return unwrap(await api.get('/reports/einvoice-register', { params }));
        case 'Purchase Register':
          return unwrap(await api.get('/reports/purchase-register', { params }));
        case 'Stock Summary':
          return unwrap(await api.get('/reports/stock-summary'));
        case 'Stock Movement':
          return unwrap(await api.get('/reports/stock-movement', { params }));
        case 'Low Stock Alert':
          return unwrap(await api.get('/reports/low-stock'));
        case 'Outstanding Receivables':
          return unwrap(await api.get('/reports/outstanding-receivables'));
        case 'Outstanding Payables':
          return unwrap(await api.get('/reports/outstanding-payables'));
        case 'Item-wise Sales':
          return unwrap(await api.get('/reports/item-wise-profit', { params }));
        case 'Party-wise Sales':
          return unwrap(await api.get('/reports/party-wise-sales', { params }));
        case 'Party-wise Purchase':
          return unwrap(await api.get('/reports/party-wise-purchase', { params }));
        case 'Profit & Loss':
          return unwrap(await api.get('/reports/profit-loss', { params }));
        case 'GSTR-1 Data':
          return unwrap(await api.get('/gst/gstr1', { params: { month, year } }));
        case 'GSTR-3B Summary':
          return unwrap(await api.get('/gst/gstr3b', { params: { month, year } }));
        case 'HSN Summary':
          return unwrap(await api.get('/gst/hsn-summary', { params: { month, year } }));
        case 'Input Tax Credit':
          return unwrap(await api.get('/gst/input-credit', { params }));
        case 'GST Out/In summary':
          return unwrap(await api.get('/reports/gst', { params }));
        case 'Trial Balance':
          return unwrap(await api.get('/reports/trial-balance', { params }));
        case 'Balance Sheet':
          return unwrap(await api.get('/reports/balance-sheet', { params }));
        case 'Day Book':
          return unwrap(await api.get('/reports/day-book', { params }));
        case 'Expense Summary':
          return unwrap(await api.get('/reports/expense-summary', { params }));
        case 'Payment Collection':
          return unwrap(await api.get('/reports/payment-collection', { params }));
        case 'TCS / TDS':
          return unwrap(await api.get('/reports/tcs-tds', { params }));
        default:
          throw new Error('Unknown report');
      }
    },
  });

  const tableRows = useMemo((): Record<string, unknown>[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    if (activeReport === 'GSTR-1 Data' && data && typeof data === 'object') {
      const d = data as { b2b?: Record<string, unknown>[]; b2cs?: Record<string, unknown>[] };
      const b2b = (d.b2b || []).map((r) => ({ ...r, segment: 'B2B' }));
      const b2cs = (d.b2cs || []).map((r) => ({ ...r, segment: 'B2CS', gstin: (r as { gstin?: string }).gstin ?? '' }));
      return [...b2b, ...b2cs];
    }
    if (activeReport === 'Trial Balance' && data && typeof data === 'object' && 'rows' in data && Array.isArray((data as { rows: unknown }).rows)) {
      return (data as { rows: Record<string, unknown>[] }).rows;
    }
    return [];
  }, [data, activeReport]);

  const buildExportPayload = useCallback((): { filename: string; rows: Record<string, unknown>[] } | null => {
    const slug = activeReport.replace(/\s+/g, '-').toLowerCase();
    const base = `${slug}_${appliedFrom}_${appliedTo}`;

    if (Array.isArray(data)) {
      return { filename: base, rows: data as Record<string, unknown>[] };
    }
    if (activeReport === 'GSTR-1 Data' && data && typeof data === 'object') {
      const d = data as { b2b?: Record<string, unknown>[]; b2cs?: Record<string, unknown>[] };
      const rows = [
        ...(d.b2b || []).map((r) => ({ ...r, segment: 'B2B' })),
        ...(d.b2cs || []).map((r) => ({ ...r, segment: 'B2CS' })),
      ];
      return { filename: base, rows };
    }
    if (activeReport === 'Trial Balance' && data && typeof data === 'object' && 'rows' in data && Array.isArray((data as { rows: unknown }).rows)) {
      return { filename: base, rows: (data as { rows: Record<string, unknown>[] }).rows };
    }
    if (data && typeof data === 'object') {
      const flat = keyValueRows(data as Record<string, unknown>);
      return {
        filename: base,
        rows: flat.map((r) => ({ field: r.key, value: r.value })),
      };
    }
    return null;
  }, [activeReport, appliedFrom, appliedTo, data]);

  const inferColumns = (rows: Record<string, unknown>[]): { headers: string[]; keys: string[] } => {
    if (!rows.length) return { headers: [], keys: [] };
    const keys = Object.keys(rows[0]);
    const headers = keys.map((k) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
    return { headers, keys };
  };

  const handleExportCsv = () => {
    const payload = buildExportPayload();
    if (!payload || !payload.rows.length) {
      toast.error('Nothing to export for this report');
      return;
    }
    const { headers, keys } = inferColumns(payload.rows);
    downloadCsv(`${payload.filename}.csv`, headers, keys, payload.rows);
    toast.success('CSV downloaded');
  };

  const handleExportExcel = () => {
    const payload = buildExportPayload();
    if (!payload || !payload.rows.length) {
      toast.error('Nothing to export for this report');
      return;
    }
    downloadXlsx(`${payload.filename}.xlsx`, activeReport.slice(0, 31), payload.rows);
    toast.success('Excel file downloaded');
  };

  const moneyKeys = new Set([
    'gross',
    'total_expenses',
    'net_profit',
    'cost_of_goods',
    'discounts',
    'tax_collected',
    'balance_due',
    'debit_paise',
    'credit_paise',
    'total_paise',
    'invoice_total_paise',
    'bill_total_paise',
    'taxable_total_paise',
    'sales_taxable_paise',
    'cogs_paise',
    'gross_profit_paise',
    'tds_deducted_paise',
    'tcs_collected_paise',
    'taxable_value',
    'total',
    'taxable',
    'cgst',
    'sgst',
    'igst',
    'cess',
    'total_amount',
    'taxable_amount',
    'unit_cost',
    'purchase_price_paise',
    'total_value_paise',
    'balance_due',
    'outward_taxable',
    'cess_payable',
  ]);
  const isMoneyKey = (k: string) =>
    moneyKeys.has(k) ||
    /_paise$|_amount$|amount$/i.test(k) ||
    (/(taxable|total|balance|cgst|sgst|igst|cess|value|profit|due)/i.test(k) &&
      !/(invoice_number|bill_number|party_name|item_name|tax_invoice|payment_status|account_type|movement_type|segment|gst_rate|line_count|qty|quantity|days|count)/i.test(k));

  const renderCell = (key: string, value: unknown) => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'number' && isMoneyKey(key)) return formatMoney(value);
    if (typeof value === 'string' && isMoneyKey(key) && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return formatMoney(Number(value));
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return formatDate(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const renderProfitLoss = (pl: Record<string, unknown>) => {
    const period = pl.period as { from?: string; to?: string } | undefined;
    return (
    <div className="space-y-6 text-sm max-w-2xl">
      <p className="text-muted-foreground">
        Period {period?.from ? formatDate(period.from) : formatDate(appliedFrom)} –{' '}
        {period?.to ? formatDate(period.to) : formatDate(appliedTo)}
      </p>
      <div className="rounded-lg border p-4 space-y-2">
        <h3 className="font-semibold">Revenue</h3>
        <div className="flex justify-between"><span>Taxable turnover (excl. GST)</span><span className="tabular-nums font-medium">{formatMoney(Number((pl.revenue as { gross?: number })?.gross))}</span></div>
        <div className="flex justify-between text-muted-foreground"><span>GST collected (informational)</span><span className="tabular-nums">{formatMoney(Number((pl.revenue as { tax_collected?: number })?.tax_collected))}</span></div>
        <div className="flex justify-between text-muted-foreground"><span>Discounts</span><span className="tabular-nums">{formatMoney(Number((pl.revenue as { discounts?: number })?.discounts))}</span></div>
      </div>
      <div className="rounded-lg border p-4 space-y-2">
        <h3 className="font-semibold">Cost & expenses</h3>
        <div className="flex justify-between"><span>Cost of goods sold (qty × purchase price)</span><span className="tabular-nums font-medium">{formatMoney(Number(pl.cost_of_goods))}</span></div>
        <div className="flex justify-between"><span>Gross profit</span><span className="tabular-nums font-semibold">{formatMoney(Number(pl.gross_profit))}</span></div>
        <div className="flex justify-between text-muted-foreground"><span>Gross margin</span><span>{String(pl.gross_margin_pct)}%</span></div>
        <div className="pt-2 border-t space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase">Expenses by category</p>
          {((pl.expenses as { category?: string; total?: string | number }[]) || []).map((e) => (
            <div key={e.category} className="flex justify-between"><span>{e.category}</span><span className="tabular-nums">{formatMoney(Number(e.total))}</span></div>
          ))}
        </div>
        <div className="flex justify-between pt-2 border-t font-semibold"><span>Total expenses (booked base)</span><span className="tabular-nums">{formatMoney(Number(pl.total_expenses))}</span></div>
      </div>
      <div className="rounded-lg border p-4 bg-indigo-50/50 border-indigo-100">
        <div className="flex justify-between text-lg font-bold"><span>Net profit</span><span className="tabular-nums">{formatMoney(Number(pl.net_profit))}</span></div>
        <div className="flex justify-between text-sm text-muted-foreground mt-1"><span>Net margin</span><span>{String(pl.net_margin_pct)}%</span></div>
      </div>
    </div>
    );
  };

  const renderTcsTds = (t: Record<string, unknown>) => (
    <div className="max-w-md space-y-3 text-sm">
      <div className="flex justify-between border-b pb-2"><span>TCS collected (sales)</span><span className="tabular-nums font-medium">{formatMoney(Number(t.tcs_collected_paise))}</span></div>
      <div className="flex justify-between border-b pb-2"><span>TDS deducted (purchases)</span><span className="tabular-nums font-medium">{formatMoney(Number(t.tds_deducted_paise))}</span></div>
    </div>
  );

  const renderBalanceSheet = (bs: Record<string, unknown>) => {
    const assets = bs.assets as { lines?: { code?: string; name?: string; closing_balance_paise?: number }[]; total_paise?: number };
    const liab = bs.liabilities as { lines?: { code?: string; name?: string; closing_balance_paise?: number }[]; total_paise?: number };
    const eq = bs.equity as { lines?: { code?: string; name?: string; closing_balance_paise?: number }[]; total_paise?: number };
    const check = bs.check as { assets_minus_liabilities_equity_paise?: number; note?: string };
    const block = (title: string, section: typeof assets) => (
      <div className="mb-6">
        <h3 className="font-semibold mb-2 border-b pb-1">{title}</h3>
        <table className="w-full text-sm">
          <tbody>
            {(section?.lines || []).map((line, i) => (
              <tr key={`${line.code}-${i}`} className="border-b border-slate-100">
                <td className="py-1.5 pr-2 font-mono text-xs text-muted-foreground">{line.code || '—'}</td>
                <td className="py-1.5">{line.name}</td>
                <td className="py-1.5 text-right tabular-nums font-medium">{formatMoney(Number(line.closing_balance_paise || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end pt-2 font-bold tabular-nums">{formatMoney(Number(section?.total_paise || 0))}</div>
      </div>
    );
    return (
      <div className="space-y-4 text-sm max-w-3xl">
        <p className="text-muted-foreground text-xs">{check?.note}</p>
        {block('Assets', assets)}
        {block('Liabilities', liab)}
        {block('Equity', eq)}
        <p className="text-xs text-muted-foreground">
          Check (assets − liabilities − equity): {formatMoney(Number(check?.assets_minus_liabilities_equity_paise || 0))}
        </p>
      </div>
    );
  };

  const renderGstr3b = (g: Record<string, unknown>) => (
    <div className="grid sm:grid-cols-2 gap-4 text-sm max-w-3xl">
      <Card><CardContent className="p-4 space-y-2">
        <h3 className="font-semibold">Outward</h3>
        <p className="text-muted-foreground text-xs">FP {String(g.fp)}</p>
        <div className="flex justify-between"><span>Taxable</span><span className="tabular-nums">{formatMoney(Number(g.outward_taxable))}</span></div>
        <div className="flex justify-between"><span>CGST</span><span className="tabular-nums">{formatMoney(Number((g.outward_tax as { cgst?: number })?.cgst))}</span></div>
        <div className="flex justify-between"><span>SGST</span><span className="tabular-nums">{formatMoney(Number((g.outward_tax as { sgst?: number })?.sgst))}</span></div>
        <div className="flex justify-between"><span>IGST</span><span className="tabular-nums">{formatMoney(Number((g.outward_tax as { igst?: number })?.igst))}</span></div>
        <div className="flex justify-between"><span>Cess</span><span className="tabular-nums">{formatMoney(Number((g.outward_tax as { cess?: number })?.cess))}</span></div>
      </CardContent></Card>
      <Card><CardContent className="p-4 space-y-2">
        <h3 className="font-semibold">ITC & net</h3>
        <div className="flex justify-between"><span>ITC CGST</span><span className="tabular-nums">{formatMoney(Number((g.itc_available as { cgst?: number })?.cgst))}</span></div>
        <div className="flex justify-between"><span>ITC SGST</span><span className="tabular-nums">{formatMoney(Number((g.itc_available as { sgst?: number })?.sgst))}</span></div>
        <div className="flex justify-between"><span>ITC IGST</span><span className="tabular-nums">{formatMoney(Number((g.itc_available as { igst?: number })?.igst))}</span></div>
        <div className="pt-2 border-t flex justify-between font-semibold"><span>Net CGST</span><span className="tabular-nums">{formatMoney(Number((g.net_liability as { cgst?: number })?.cgst))}</span></div>
        <div className="flex justify-between font-semibold"><span>Net SGST</span><span className="tabular-nums">{formatMoney(Number((g.net_liability as { sgst?: number })?.sgst))}</span></div>
        <div className="flex justify-between font-semibold"><span>Net IGST</span><span className="tabular-nums">{formatMoney(Number((g.net_liability as { igst?: number })?.igst))}</span></div>
        <div className="flex justify-between font-semibold"><span>Net cess</span><span className="tabular-nums">{formatMoney(Number((g.net_liability as { cess?: number })?.cess))}</span></div>
      </CardContent></Card>
    </div>
  );

  const renderInputCredit = (itc: Record<string, unknown>) => (
    <div className="space-y-4 text-sm max-w-xl">
      <div className="rounded-lg border p-4 space-y-2">
        <h3 className="font-semibold">From purchase bills</h3>
        <div className="flex justify-between"><span>CGST</span><span className="tabular-nums">{formatMoney(Number((itc.from_purchase_bills as { cgst?: number })?.cgst))}</span></div>
        <div className="flex justify-between"><span>SGST</span><span className="tabular-nums">{formatMoney(Number((itc.from_purchase_bills as { sgst?: number })?.sgst))}</span></div>
        <div className="flex justify-between"><span>IGST</span><span className="tabular-nums">{formatMoney(Number((itc.from_purchase_bills as { igst?: number })?.igst))}</span></div>
      </div>
      <div className="rounded-lg border p-4 space-y-2">
        <h3 className="font-semibold">From GST expenses</h3>
        <div className="flex justify-between"><span>CGST</span><span className="tabular-nums">{formatMoney(Number((itc.from_expenses as { cgst?: number })?.cgst))}</span></div>
        <div className="flex justify-between"><span>SGST</span><span className="tabular-nums">{formatMoney(Number((itc.from_expenses as { sgst?: number })?.sgst))}</span></div>
        <div className="flex justify-between"><span>IGST</span><span className="tabular-nums">{formatMoney(Number((itc.from_expenses as { igst?: number })?.igst))}</span></div>
      </div>
      <div className="rounded-lg border p-4 bg-emerald-50/50 font-semibold flex justify-between">
        <span>Total ITC</span>
        <span className="tabular-nums">{formatMoney(Number((itc.total_itc as { combined?: number })?.combined))}</span>
      </div>
    </div>
  );

  const renderGstSummary = (gst: Record<string, unknown>) => (
    <div className="grid md:grid-cols-2 gap-6 text-sm">
      <div>
        <h3 className="font-semibold mb-2">Outward supplies (by GST %)</h3>
        <table className="w-full text-xs border rounded-md overflow-hidden">
          <thead className="bg-muted/50"><tr><th className="p-2 text-left">Rate</th><th className="p-2 text-right">Taxable</th><th className="p-2 text-right">Tax</th></tr></thead>
          <tbody>
            {((gst.outward_supplies as Record<string, unknown>[]) || []).map((r) => (
              <tr key={String(r.gst_rate)} className="border-t">
                <td className="p-2">{String(r.gst_rate)}%</td>
                <td className="p-2 text-right tabular-nums">{formatMoney(Number(r.taxable_value))}</td>
                <td className="p-2 text-right tabular-nums">
                  {formatMoney(Number(r.cgst) + Number(r.sgst) + Number(r.igst) + Number(r.cess || 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="font-semibold mb-2">Inward / ITC basis (by GST %)</h3>
        <table className="w-full text-xs border rounded-md overflow-hidden">
          <thead className="bg-muted/50"><tr><th className="p-2 text-left">Rate</th><th className="p-2 text-right">Taxable</th><th className="p-2 text-right">Tax</th></tr></thead>
          <tbody>
            {((gst.inward_supplies as Record<string, unknown>[]) || []).map((r) => (
              <tr key={String(r.gst_rate)} className="border-t">
                <td className="p-2">{String(r.gst_rate)}%</td>
                <td className="p-2 text-right tabular-nums">{formatMoney(Number(r.taxable_value))}</td>
                <td className="p-2 text-right tabular-nums">
                  {formatMoney(Number(r.cgst) + Number(r.sgst) + Number(r.igst) + Number(r.cess || 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:col-span-2 rounded-lg border p-4 bg-amber-50/40 text-sm space-y-1">
        <div>
          <span className="font-semibold">Net GST (CGST+SGST+IGST+cess, out − in): </span>
          <span className="tabular-nums font-bold">
            {formatMoney(Number((gst.summary as { total_payable?: number })?.total_payable))}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Net cess: {formatMoney(Number((gst.summary as { cess_payable?: number })?.cess_payable ?? 0))}
        </div>
      </div>
    </div>
  );

  const renderDataTable = () => {
    if (activeReport === 'Profit & Loss' && data && typeof data === 'object' && !Array.isArray(data)) {
      return renderProfitLoss(data as Record<string, unknown>);
    }
    if (activeReport === 'Balance Sheet' && data && typeof data === 'object') {
      return renderBalanceSheet(data as Record<string, unknown>);
    }
    if (activeReport === 'GSTR-3B Summary' && data && typeof data === 'object') {
      return renderGstr3b(data as Record<string, unknown>);
    }
    if (activeReport === 'Input Tax Credit' && data && typeof data === 'object') {
      return renderInputCredit(data as Record<string, unknown>);
    }
    if (activeReport === 'TCS / TDS' && data && typeof data === 'object') {
      return renderTcsTds(data as Record<string, unknown>);
    }

    const rows = tableRows;
    if (!rows.length) {
      if (data && typeof data === 'object' && !Array.isArray(data) && activeReport !== 'Profit & Loss' && activeReport !== 'Balance Sheet') {
        if (activeReport === 'TCS / TDS' || activeReport === 'GSTR-3B Summary' || activeReport === 'Input Tax Credit') return null;
        return renderGstSummary(data as Record<string, unknown>);
      }
      return <p className="text-muted-foreground text-sm">No rows in this period.</p>;
    }
    const keys = Object.keys(rows[0]);
    return (
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              {keys.map((k) => (
                <th key={k} className="p-2 text-left font-medium whitespace-nowrap">
                  {k.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b hover:bg-muted/20">
                {keys.map((k) => (
                  <td key={k} className="p-2 align-top tabular-nums text-xs sm:text-sm">
                    {renderCell(k, row[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-theme(spacing.16))] bg-slate-50/50 animate-in slide-in-from-bottom-4 duration-500">
      <div className="md:hidden border-b bg-white p-3 flex items-center gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => setMobileMenuOpen(true)}>
          {activeReport} <ChevronDown className="w-4 h-4 ml-1 opacity-60" />
        </Button>
      </div>
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-[280px]">
          <SheetHeader><SheetTitle>Reports</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4 overflow-y-auto max-h-[80vh]">
            {reportCategories.map((cat) => (
              <div key={cat.id}>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">{cat.title}</h3>
                <div className="space-y-1">
                  {cat.reports.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setActiveReport(r as ReportName);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md ${activeReport === r ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-slate-100'}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <div className="w-64 border-r bg-white p-4 overflow-y-auto hidden md:block shrink-0">
        <h2 className="text-xl font-bold mb-6 text-slate-800 tracking-tight">Report Center</h2>
        {reportCategories.map((cat) => (
          <div key={cat.id} className="mb-6">
            <h3 className="text-xs font-semibold uppercase text-slate-500 tracking-wider mb-3">{cat.title}</h3>
            <div className="space-y-1">
              {cat.reports.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setActiveReport(r as ReportName)}
                  className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${activeReport === r ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-auto min-h-14 border-b flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 bg-white shrink-0">
          <h1 className="text-lg sm:text-xl font-semibold flex items-center gap-2 min-w-0">
            <FileText className="w-5 h-5 text-indigo-500 shrink-0" />
            <span className="truncate">{activeReport}</span>
          </h1>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setFiltersOpen(true)}>
              <Filter className="w-4 h-4 mr-2" /> Filters
            </Button>
            <Button variant="outline" size="sm" type="button" onClick={handleExportCsv}>
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" type="button" className="bg-green-50 text-green-800 border-green-200 hover:bg-green-100" onClick={handleExportExcel}>
              <Download className="w-4 h-4 mr-2" /> Excel
            </Button>
          </div>
        </div>

        <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
          <p className="text-xs text-muted-foreground mb-4">
            Showing <span className="font-medium text-foreground">{appliedFrom}</span> to <span className="font-medium text-foreground">{appliedTo}</span>
            {['GSTR-1 Data', 'GSTR-3B Summary', 'HSN Summary'].includes(activeReport) && (
              <span className="ml-2">· GST month {month}/{year} (from &quot;from&quot; date)</span>
            )}
          </p>
          <Card>
            <CardContent className="p-4 sm:p-6">
              {isLoading && <p className="text-muted-foreground text-sm">Loading report…</p>}
              {isError && (
                <div className="text-sm text-red-600 space-y-2">
                  <p>{(error as { response?: { data?: { error?: string } } })?.response?.data?.error || (error as Error)?.message || 'Failed to load report'}</p>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
                </div>
              )}
              {!isLoading && !isError && renderDataTable()}
            </CardContent>
          </Card>
        </div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent>
          <SheetHeader className="mb-4">
            <SheetTitle>Report filters</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div>
              <Label>From date</Label>
              <Input type="date" className="mt-1" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label>To date</Label>
              <Input type="date" className="mt-1" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              GST month-based reports (GSTR-1, 3B, HSN) use the calendar month of the &quot;from&quot; date.
            </p>
            <div className="flex gap-2 pt-4">
              <Button variant="outline" className="flex-1" type="button" onClick={() => setFiltersOpen(false)}>Cancel</Button>
              <Button className="flex-1" type="button" onClick={applyFilters}>Apply</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
