import { BarChart3, Boxes, FileText, IndianRupee, Receipt } from 'lucide-react';

const visualBySlug: Record<string, { title: string; metric: string; rows: Array<[string, string, string]> }> = {
  'gst-software': { title: 'GST Overview', metric: 'Tax summary', rows: [['GST 5%', '₹42,500', 'Ready'], ['GST 12%', '₹18,240', 'Ready'], ['GST 18%', '₹67,100', 'Review']] },
  'billing-software': { title: 'POS Billing', metric: 'Amount due', rows: [['Premium Service', '2', '₹826'], ['Material Pack', '1', '₹590'], ['Delivery', '1', '₹120']] },
  'gst-billing-software': { title: 'Tax Invoice', metric: 'Invoice total', rows: [['Taxable value', '', '₹20,000'], ['CGST', '9%', '₹1,800'], ['SGST', '9%', '₹1,800']] },
  'accounting-software': { title: 'Business Accounts', metric: 'Current position', rows: [['Receivables', '', '₹1,24,500'], ['Payables', '', '₹48,200'], ['Cash & bank', '', '₹76,300']] },
  'gst-accounting-software': { title: 'GST & Ledgers', metric: 'Tax position', rows: [['Output GST', '', '₹32,400'], ['Input GST', '', '₹21,800'], ['Net payable', '', '₹10,600']] },
  'invoice-software': { title: 'Invoice Preview', metric: 'Balance due', rows: [['Professional Service', '1', '₹5,900'], ['Implementation', '2', '₹8,260'], ['Payment received', '', '₹5,000']] },
  'inventory-management-software': { title: 'Stock Control', metric: 'Items tracked', rows: [['Composite Panels', '424 PCS', 'In stock'], ['Packing Material', '18 PCS', 'Low'], ['Service Item', '-', 'Service']] },
  'gst-reports': { title: 'GST Reports', metric: 'Reporting period', rows: [['GSTR sales', '126 docs', 'Ready'], ['HSN summary', '38 codes', 'Ready'], ['Rate report', '7 rates', 'Ready']] },
  pricing: { title: 'Plan Workspace', metric: 'Start with a trial', rows: [['Billing & GST', '', 'Included'], ['Inventory & reports', '', 'Included'], ['Team access', '', 'By plan']] }
};

export default function ProductWorkspaceVisual({ slug }: { slug: string }) {
  const view = visualBySlug[slug] || visualBySlug['billing-software'];
  const navigationItems: Array<[typeof BarChart3, string]> = [
    [BarChart3, 'Overview'],
    [FileText, 'Transactions'],
    [Boxes, 'Inventory'],
    [IndianRupee, 'Accounts']
  ];

  return (
    <figure className="pointer-events-none absolute inset-y-10 right-0 hidden w-[58%] overflow-hidden border-y border-l border-slate-200 bg-white/90 shadow-2xl lg:block" aria-label={`${view.title} interface preview`}>
      <div className="flex h-12 items-center justify-between border-b border-slate-200 px-5">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Receipt className="h-4 w-4 text-[#420662]" /> {view.title}</div>
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">LIVE WORKSPACE</span>
      </div>
      <div className="grid grid-cols-[150px_1fr]">
        <div className="min-h-[470px] border-r border-slate-200 bg-slate-950 p-3 text-slate-300">
          {navigationItems.map(([VisualIcon, label], index) => {
            return <div key={label} className={`mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-xs ${index === 1 ? 'bg-white/10 text-white' : ''}`}><VisualIcon className="h-4 w-4" /> {label}</div>;
          })}
        </div>
        <div className="p-5">
          <p className="text-[10px] font-bold uppercase text-slate-500">{view.metric}</p>
          <div className="mt-2 flex items-end justify-between border-b border-slate-200 pb-4">
            <strong className="text-3xl text-slate-900">₹23,600</strong>
            <div className="flex h-12 items-end gap-1" aria-hidden="true">
              {[18, 28, 22, 40, 32, 48, 42].map((height, index) => <span key={index} className="w-3 bg-[#420662]" style={{ height }} />)}
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded-md border border-slate-200">
            <div className="grid grid-cols-[1.4fr_.7fr_.8fr] bg-slate-100 px-3 py-2 text-[10px] font-bold uppercase text-slate-500">
              <span>Details</span><span>Value</span><span className="text-right">Status / Amount</span>
            </div>
            {view.rows.map((row) => (
              <div key={row[0]} className="grid grid-cols-[1.4fr_.7fr_.8fr] border-t border-slate-200 px-3 py-3 text-xs text-slate-700">
                <strong>{row[0]}</strong><span>{row[1]}</span><span className="text-right font-semibold">{row[2]}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            {['Invoice', 'Payment', 'Report'].map((label) => <div key={label} className="border-l-2 border-amber-500 bg-amber-50 px-3 py-3 text-xs font-semibold text-slate-700">{label}</div>)}
          </div>
        </div>
      </div>
      <figcaption className="sr-only">A representative Microtechnique Accounts workspace showing connected transaction, inventory and accounting information.</figcaption>
    </figure>
  );
}
