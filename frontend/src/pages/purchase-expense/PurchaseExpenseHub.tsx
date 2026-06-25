/**
 * PurchaseExpenseHub — combined Purchase & Expense section.
 * Tabs: Purchase Bills | Payment-Out | Expenses | Purchase Orders | Purchase Return
 * URL: /purchase-expense/:tab  (default: bills)
 */

import { useNavigate, useParams } from 'react-router-dom';

// Sub-sections
import PurchaseBillsTab from './tabs/PurchaseBillsTab';
import PaymentOutTab from './tabs/PaymentOutTab';
import ExpensesTab from './tabs/ExpensesTab';
import PurchaseOrdersTab from './tabs/PurchaseOrdersTab';
import PurchaseReturnTab from './tabs/PurchaseReturnTab';

const TABS = [
  { key: 'bills', label: 'Purchase Bills' },
  { key: 'orders', label: 'Purchase Orders' },
  { key: 'payment-out', label: 'Payment-Out' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'returns', label: 'Purchase Return / Dr. Note' },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function PurchaseExpenseHub() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab: string }>();
  const activeTab: TabKey = (TABS.find(t => t.key === tab)?.key) ?? 'bills';

  const goTab = (key: TabKey) => navigate(`/purchase-expense/${key}`, { replace: true });

  return (
    <div className="space-y-0">
      {/* Tab Bar */}
      <div className="flex items-center gap-0 border-b overflow-x-auto bg-background sticky top-0 z-10">
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
      <div className="pt-5">
        {activeTab === 'bills' && <PurchaseBillsTab />}
        {activeTab === 'orders' && <PurchaseOrdersTab />}
        {activeTab === 'payment-out' && <PaymentOutTab />}
        {activeTab === 'expenses' && <ExpensesTab />}
        {activeTab === 'returns' && <PurchaseReturnTab />}
      </div>
    </div>
  );
}
