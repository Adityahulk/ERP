import { Building2, Mail, MapPin, Phone } from 'lucide-react';
import { getApiBaseURL } from '@/lib/api';

const NAVY = '#1e3a5f';

function money(value: unknown) {
  return `₹${((Number(value) || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fullDate(value: unknown) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${weekdays[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, '0')} ${date.getUTCFullYear()} 00:00:00 GMT+0000 (Coordinated Universal Time)`;
}

function assetUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(https?:|data:|blob:)/.test(raw)) return raw;
  return `${getApiBaseURL().replace(/\/api$/, '')}/${raw.replace(/^\/+/, '')}`;
}

function taxLabel(name: string, items: any[], key: string) {
  const values = Array.from(new Set(items.map((item) => Number(item[key]) || 0).filter(Boolean)));
  return values.length === 1 ? `${name} (${values[0]}%)` : values.length ? `${name} (multiple rates)` : name;
}

function terms(value: unknown) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim().replace(/^\d+[.)]\s*/, '')).filter(Boolean);
}

export default function QuotationDocument({ quote, items }: { quote: Record<string, any>; items: Array<Record<string, any>> }) {
  const logo = assetUrl(quote.seller_logo_url);
  const signature = assetUrl(quote.seller_signature_url);
  const sellerLocation = [quote.seller_city, quote.seller_state, 'India'].filter(Boolean).join(', ');
  const buyerState = [quote.party_state_code, quote.party_state].filter(Boolean).join(' - ') || '—';
  const interstate = quote.is_interstate === true || Number(quote.igst_amount || 0) > 0;
  return <div className="overflow-x-auto rounded-md border bg-slate-100 p-2 sm:p-4">
    <article className="relative mx-auto min-w-[760px] max-w-[920px] overflow-hidden border border-slate-300 bg-white px-8 pb-12 pt-8 text-[11px] text-slate-800 shadow-sm">
      <div className="absolute right-0 top-0 h-14 w-24" style={{ background: `linear-gradient(145deg,${NAVY} 0 55%,#8fb8d8 55% 76%,transparent 76%)` }} />
      <header className="relative min-h-[88px] pr-[250px]">
        <div className="flex items-center gap-3">{logo ? <img src={logo} alt="Company logo" className="h-14 w-14 rounded-full border-2 object-contain p-1" style={{ borderColor: NAVY }} /> : <Building2 className="h-12 w-12" style={{ color: NAVY }} />}<div><h2 className="font-serif text-2xl font-bold" style={{ color: NAVY }}>{quote.seller_name || 'Company'}</h2>{quote.seller_tagline && <p className="mt-1 italic text-slate-500">{quote.seller_tagline}</p>}</div></div>
        <div className="absolute right-[108px] top-7 whitespace-nowrap text-right"><h1 className="text-3xl font-extrabold" style={{ color: NAVY }}>Quotation</h1><div className="ml-auto mt-2 h-1 w-24" style={{ background: NAVY }} /></div>
      </header>
      <div className="my-3 h-px" style={{ background: NAVY }} />
      <section className="my-4 grid grid-cols-[1fr_390px] items-end gap-6"><div className="space-y-1 text-slate-600">{quote.seller_phone && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" />Phone no.: {quote.seller_phone}</p>}{quote.seller_email && <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" />Email: {quote.seller_email}</p>}</div><div className="border border-slate-400 bg-slate-50">{[['Quote No', quote.quotation_number || '—'], ['Date', fullDate(quote.quotation_date)], ['Valid Until', fullDate(quote.valid_until)]].map(([label, value]) => <div key={label} className="grid grid-cols-[92px_1fr] border-b border-slate-300 px-2 py-1.5 last:border-b-0"><span className="text-slate-500">{label}</span><strong className="text-right text-[10px]">{value}</strong></div>)}</div></section>
      <section className="grid grid-cols-2 gap-3"><PartyCard title="Seller" name={quote.seller_name || 'Company'} rows={[['Phone no.', quote.seller_phone || '—'], ['Email', quote.seller_email || '—']]} /><PartyCard title="Buyer" name={quote.party_name || quote.party_name_override || 'Customer'} rows={[['Location', quote.party_address || '—'], ['Phone no.', quote.party_phone || '—'], ['GSTIN', quote.party_gstin || 'URP'], ['State', buyerState]]} /></section>
      <ItemsTable items={items} />
      <div className="mt-3 flex justify-end"><div className="w-[320px] border border-slate-400 bg-slate-50"><Total label="Subtotal" value={money(quote.subtotal)} /><Total label="Discount" value={money(quote.discount_amount)} /><Total label="Taxable" value={money(quote.taxable_amount)} />{interstate ? <Total label={taxLabel('IGST', items, 'igst_rate')} value={money(quote.igst_amount)} /> : <><Total label={taxLabel('CGST', items, 'cgst_rate')} value={money(quote.cgst_amount)} /><Total label={taxLabel('SGST', items, 'sgst_rate')} value={money(quote.sgst_amount)} /></>}<div className="flex justify-between px-3 py-2 text-sm font-extrabold text-white" style={{ background: NAVY }}><span>Grand Total</span><span>{money(quote.total_amount)}</span></div></div></div>
      <section className="mt-3 grid grid-cols-3 border border-slate-400"><Footer label="Payment Terms" value={quote.payment_terms} /><Footer label="Delivery Terms" value={quote.delivery_terms} /><Footer label="Customer Notes" value={quote.customer_notes} last /></section>
      <section className="grid min-h-[120px] grid-cols-[1fr_235px] border-x border-b border-slate-400"><div className="p-3"><p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider" style={{ color: NAVY }}>Terms &amp; Conditions</p>{terms(quote.terms_and_conditions).length ? <ol className="list-decimal space-y-1 pl-5">{terms(quote.terms_and_conditions).map((term, index) => <li key={index}>{term}</li>)}</ol> : '—'}</div><div className="flex flex-col items-center border-l border-slate-400 p-3 text-center"><strong>For {quote.seller_name || 'Company'}</strong>{signature ? <img src={signature} alt="Authorised signature" className="my-auto max-h-12 max-w-32 object-contain" /> : <div className="h-12" />}<div className="w-36 border-t border-slate-500 pt-1">Authorised Signatory</div></div></section>
      <section className="mt-4 grid grid-cols-[1fr_310px]"><div className="flex items-center gap-2 border-t border-slate-400 px-2 py-2 text-slate-600"><MapPin className="h-3.5 w-3.5" />{sellerLocation || 'India'}</div><div className="py-2 text-center font-extrabold text-white" style={{ background: NAVY }}>Thank you for your business!</div></section>
      <div className="absolute bottom-0 right-0 h-7 w-24" style={{ background: `linear-gradient(145deg,transparent 0 25%,#8fb8d8 25% 52%,${NAVY} 52%)` }} />
    </article>
  </div>;
}

function PartyCard({ title, name, rows }: { title: string; name: string; rows: Array<[string, string]> }) { return <article className="min-h-28 border border-slate-400"><div className="px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-widest text-white" style={{ background: NAVY }}>{title}</div><div className="space-y-1 p-2.5"><p className="text-sm font-extrabold">{name}</p>{rows.map(([label, value]) => <p key={label} className="grid grid-cols-[64px_1fr] gap-1.5"><span className="text-slate-500">{label}</span><strong className="font-medium">{value}</strong></p>)}</div></article>; }
function ItemsTable({ items }: { items: any[] }) { return <div className="mt-3 overflow-x-auto"><table className="w-full table-fixed border-collapse"><colgroup><col className="w-[5%]" /><col className="w-[29%]" /><col className="w-[10%]" /><col className="w-[8%]" /><col className="w-[12%]" /><col className="w-[11%]" /><col className="w-[9%]" /><col className="w-[16%]" /></colgroup><thead className="text-white" style={{ background: NAVY }}><tr>{['#', 'Item', 'HSN', 'Qty', 'Rate', 'Disc', 'GST', 'Total'].map((label) => <th key={label} className="border border-slate-400 px-1.5 py-2 text-left text-[10px] uppercase">{label}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={item.id || index} className="even:bg-slate-50"><td className="border border-slate-400 p-2 text-center">{index + 1}</td><td className="border border-slate-400 p-2"><strong>{item.item_name || 'Item'}</strong>{item.item_description && <p className="mt-1 whitespace-pre-line text-[10px] text-slate-500">{item.item_description}</p>}</td><td className="border border-slate-400 p-2 text-center font-mono">{item.hsn_code || '—'}</td><td className="border border-slate-400 p-2 text-right">{Number(item.quantity || 0).toLocaleString('en-IN')}</td><td className="border border-slate-400 p-2 text-right">{money(item.unit_price)}</td><td className="border border-slate-400 p-2 text-right">{money(item.discount_amount)}</td><td className="border border-slate-400 p-2 text-right">{Number(item.gst_rate || 0)}%</td><td className="border border-slate-400 p-2 text-right font-bold">{money(item.total_amount)}</td></tr>)}</tbody></table></div>; }
function Total({ label, value }: { label: string; value: string }) { return <div className="flex justify-between border-b border-slate-300 px-3 py-1.5"><span>{label}</span><strong>{value}</strong></div>; }
function Footer({ label, value, last = false }: { label: string; value?: string; last?: boolean }) { return <div className={`min-h-[72px] p-2.5 ${last ? '' : 'border-r border-slate-400'}`}><p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wider" style={{ color: NAVY }}>{label}</p><p className="whitespace-pre-line text-slate-700">{value || '—'}</p></div>; }
