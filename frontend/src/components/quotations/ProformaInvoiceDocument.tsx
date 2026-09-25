import { Building2, Mail, MapPin, Phone, UserRound } from 'lucide-react';
import { getApiBaseURL } from '@/lib/api';

type Props = {
  quote: Record<string, any>;
  items: Array<Record<string, any>>;
};

const NAVY = '#1e3a5f';

function money(value: unknown) {
  return `₹${((Number(value) || 0) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function displayDate(value: unknown) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function assetUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(https?:|data:|blob:)/.test(raw)) return raw;
  return `${getApiBaseURL().replace(/\/api$/, '')}/${raw.replace(/^\/+/, '')}`;
}

function rates(items: Props['items'], key: string) {
  return Array.from(new Set(items.map((item) => Number(item[key]) || 0).filter((rate) => rate > 0)));
}

function taxLabel(name: string, items: Props['items'], key: string) {
  const values = rates(items, key);
  if (values.length === 1) return `${name} (${values[0].toLocaleString('en-IN', { maximumFractionDigits: 3 })}%)`;
  if (values.length > 1) return `${name} (multiple rates)`;
  return name;
}

export default function ProformaInvoiceDocument({ quote, items }: Props) {
  const logo = assetUrl(quote.seller_logo_url);
  const signature = assetUrl(quote.seller_signature_url);
  const sellerAddress = [quote.seller_address, quote.seller_city, quote.seller_state, quote.seller_pincode].filter(Boolean).join(', ');
  const buyerGstin = quote.party_gstin || 'URP';
  const buyerState = [quote.party_state_code, quote.party_state].filter(Boolean).join(' - ') || '—';
  const interstate = quote.is_interstate === true || Number(quote.igst_amount || 0) > 0;

  return (
    <div className="overflow-x-auto rounded-md border bg-slate-100 p-2 sm:p-4">
      <article className="relative mx-auto min-w-[720px] max-w-[920px] overflow-hidden border border-slate-300 bg-white px-8 pb-12 pt-8 text-[11px] text-slate-800 shadow-sm">
        <header className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            {logo ? <img src={logo} alt="Company logo" className="h-14 w-14 rounded-full border-2 object-contain p-1" style={{ borderColor: NAVY }} /> : <Building2 className="h-12 w-12" style={{ color: NAVY }} />}
            <div>
              <h2 className="text-xl font-extrabold tracking-wide" style={{ color: NAVY }}>{quote.seller_name || 'Company'}</h2>
              {quote.seller_tagline && <p className="mt-1 italic text-slate-500">{quote.seller_tagline}</p>}
            </div>
          </div>
          {logo && <img src={logo} alt="Registered company seal" className="h-12 w-12 rounded-full border border-slate-400 object-contain p-1.5" />}
        </header>

        <div className="my-3 h-0.5" style={{ backgroundColor: NAVY }} />
        <h1 className="text-center text-2xl font-extrabold tracking-[0.12em]" style={{ color: NAVY }}>PROFORMA INVOICE</h1>
        <p className="mt-1 text-center text-[10px] text-slate-500">(For Quotation Purpose Only)</p>

        <section className="my-4 grid grid-cols-[1fr_260px] items-end gap-6">
          <div className="space-y-1 text-slate-600">
            <p className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5" />{quote.salesperson_name || 'Authorised sales representative'}</p>
            {quote.salesperson_phone && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" />{quote.salesperson_phone}</p>}
            {quote.salesperson_email && <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" />{quote.salesperson_email}</p>}
          </div>
          <div className="border border-slate-400 bg-slate-50">
            {[['Proforma No.', quote.quotation_number || '—'], ['Date', displayDate(quote.quotation_date)], ['Valid Until', displayDate(quote.valid_until)]].map(([label, value]) => (
              <div key={label} className="grid grid-cols-[95px_1fr] border-b border-slate-300 px-2 py-1.5 last:border-b-0">
                <span className="text-slate-500">{label}</span><strong className="text-right">{value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <IdentityCard title="Seller" name={quote.seller_name || 'Company'} rows={[
            ['Phone', quote.seller_phone || '—'], ['Email', quote.seller_email || '—'], ['Address', sellerAddress || '—'],
          ]} />
          <IdentityCard title="Buyer" name={quote.party_name || quote.party_name_override || 'Customer'} rows={[
            ['Location', quote.party_address || '—'], ['Phone', quote.party_phone || '—'], ['GSTIN', buyerGstin], ['State', buyerState],
          ]} />
        </section>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full table-fixed border-collapse">
            <colgroup><col className="w-[5%]" /><col className="w-[29%]" /><col className="w-[10%]" /><col className="w-[8%]" /><col className="w-[12%]" /><col className="w-[11%]" /><col className="w-[9%]" /><col className="w-[16%]" /></colgroup>
            <thead style={{ backgroundColor: '#e9eff6', color: NAVY }}>
              <tr>{['#', 'Item', 'HSN', 'Qty', 'Rate', 'Disc', 'GST', 'Total'].map((label) => <th key={label} className="border border-slate-400 px-1.5 py-2 text-left text-[10px] uppercase">{label}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id || index} className="even:bg-slate-50">
                  <td className="border border-slate-400 px-1.5 py-2 text-center">{index + 1}</td>
                  <td className="border border-slate-400 px-1.5 py-2"><strong>{item.item_name || 'Item'}</strong>{item.item_description && <p className="mt-1 whitespace-pre-line text-[10px] text-slate-500">{item.item_description}</p>}</td>
                  <td className="border border-slate-400 px-1.5 py-2 text-center font-mono">{item.hsn_code || '—'}</td>
                  <td className="border border-slate-400 px-1.5 py-2 text-right">{Number(item.quantity || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })}</td>
                  <td className="border border-slate-400 px-1.5 py-2 text-right">{money(item.unit_price)}</td>
                  <td className="border border-slate-400 px-1.5 py-2 text-right">{money(item.discount_amount)}</td>
                  <td className="border border-slate-400 px-1.5 py-2 text-right">{Number(item.gst_rate || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })}%</td>
                  <td className="border border-slate-400 px-1.5 py-2 text-right font-bold">{money(item.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex justify-end">
          <div className="w-[320px] border border-slate-400 bg-slate-50">
            <TotalRow label="Subtotal" value={money(quote.subtotal)} />
            <TotalRow label="Discount" value={money(quote.discount_amount)} />
            <TotalRow label="Taxable" value={money(quote.taxable_amount)} />
            {interstate ? <TotalRow label={taxLabel('IGST', items, 'igst_rate')} value={money(quote.igst_amount)} /> : <><TotalRow label={taxLabel('CGST', items, 'cgst_rate')} value={money(quote.cgst_amount)} /><TotalRow label={taxLabel('SGST', items, 'sgst_rate')} value={money(quote.sgst_amount)} /></>}
            <div className="flex justify-between px-3 py-2 text-sm font-extrabold text-white" style={{ backgroundColor: NAVY }}><span>Grand Total</span><span>{money(quote.total_amount)}</span></div>
          </div>
        </div>

        <section className="mt-3 grid grid-cols-3 border border-slate-400">
          <FooterCell label="Payment Terms" value={quote.payment_terms} />
          <FooterCell label="Delivery Terms" value={quote.delivery_terms} />
          <FooterCell label="Customer Notes" value={quote.customer_notes} last />
        </section>
        <section className="grid min-h-[112px] grid-cols-[1fr_240px] border-x border-b border-slate-400">
          <div className="whitespace-pre-line p-3"><p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider" style={{ color: NAVY }}>Terms &amp; Conditions</p>{quote.terms_and_conditions || '—'}</div>
          <div className="flex flex-col items-center border-l border-slate-400 p-3 text-center"><strong>For {quote.seller_name || 'Company'}</strong>{signature ? <img src={signature} alt="Authorised signature" className="my-auto max-h-12 max-w-32 object-contain" /> : <div className="h-12" />}<div className="w-36 border-t border-slate-500 pt-1">Authorised Signatory</div></div>
        </section>
        <div className="my-4 flex items-center gap-3 font-extrabold tracking-widest" style={{ color: NAVY }}><span className="h-px flex-1 bg-slate-400" />THANK YOU FOR YOUR BUSINESS!<span className="h-px flex-1 bg-slate-400" /></div>
        <div className="absolute inset-x-0 bottom-0 h-7" style={{ background: `linear-gradient(160deg, transparent 0 18%, ${NAVY} 18% 72%, #718096 72% 82%, #d8e0e9 82%)` }} />
      </article>
    </div>
  );
}

function IdentityCard({ title, name, rows }: { title: string; name: string; rows: Array<[string, string]> }) {
  return <article className="min-h-28 border border-slate-400"><div className="px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-widest" style={{ color: NAVY, backgroundColor: '#e9eff6' }}>{title}</div><div className="space-y-1 p-2.5"><p className="text-sm font-extrabold">{name}</p>{rows.map(([label, value]) => <p key={label} className="grid grid-cols-[60px_1fr] gap-1.5"><span className="flex items-center gap-1 text-slate-500">{label === 'Location' ? <MapPin className="h-3 w-3" /> : null}{label}</span><strong className="font-medium">{value}</strong></p>)}</div></article>;
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between border-b border-slate-300 px-3 py-1.5"><span>{label}</span><strong>{value}</strong></div>;
}

function FooterCell({ label, value, last = false }: { label: string; value?: string; last?: boolean }) {
  return <div className={`min-h-[72px] p-2.5 ${last ? '' : 'border-r border-slate-400'}`}><p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wider" style={{ color: NAVY }}>{label}</p><p className="whitespace-pre-line text-slate-700">{value || '—'}</p></div>;
}
