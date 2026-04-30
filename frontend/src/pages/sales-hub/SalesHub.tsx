import { useNavigate, useParams } from 'react-router-dom';
import SaleInvoicesTab from './tabs/SaleInvoicesTab';
import QuotationsTab from './tabs/QuotationsTab';
import SaleOrdersTab from './tabs/SaleOrdersTab';
import DeliveryChallansTab from './tabs/DeliveryChallansTab';
import PaymentInTab from './tabs/PaymentInTab';
import SaleReturnTab from './tabs/SaleReturnTab';

const TABS = [
  { key: 'invoices',   label: 'Sale Invoices' },
  { key: 'quotations', label: 'Estimate / Quotation' },
  { key: 'orders',     label: 'Sale Orders' },
  { key: 'challans',   label: 'Delivery Challan' },
  { key: 'payment-in', label: 'Payment-In' },
  { key: 'returns',    label: 'Sale Return / Credit Note' },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function SalesHub() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab: string }>();
  const activeTab: TabKey = (TABS.find((t) => t.key === tab)?.key) ?? 'invoices';

  const goTab = (key: TabKey) => navigate(`/sales-hub/${key}`, { replace: true });

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div className="flex items-center gap-0 border-b bg-background sticky top-0 z-10 overflow-x-auto shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => goTab(t.key)}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {activeTab === 'invoices'   && <SaleInvoicesTab />}
        {activeTab === 'quotations' && <QuotationsTab />}
        {activeTab === 'orders'     && <SaleOrdersTab />}
        {activeTab === 'challans'   && <DeliveryChallansTab />}
        {activeTab === 'payment-in' && <PaymentInTab />}
        {activeTab === 'returns'    && <SaleReturnTab />}
      </div>
    </div>
  );
}
