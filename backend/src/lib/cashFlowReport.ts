import { query } from '../config/db';

export type CashFlowLine = { label: string; amount_paise: number; direction: 'inflow' | 'outflow' };

export type CashFlowSection = {
  inflows_paise: number;
  outflows_paise: number;
  net_paise: number;
  lines: CashFlowLine[];
};

export type CashFlowReport = {
  period: { from: string; to: string };
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  net_change_paise: number;
  implemented: true;
};

function sectionFromLines(lines: CashFlowLine[]): CashFlowSection {
  const inflows_paise = lines.filter((l) => l.direction === 'inflow').reduce((s, l) => s + l.amount_paise, 0);
  const outflows_paise = lines.filter((l) => l.direction === 'outflow').reduce((s, l) => s + l.amount_paise, 0);
  return { inflows_paise, outflows_paise, net_paise: inflows_paise - outflows_paise, lines };
}

export async function buildCashFlowReport(companyId: string, from: string, to: string): Promise<CashFlowReport> {
  const payRes = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN p.payment_type IN ('incoming', 'receipt', 'payment_in') THEN p.amount ELSE 0 END), 0)::bigint AS inflows,
       COALESCE(SUM(CASE WHEN p.payment_type IN ('outgoing', 'payment_out') THEN p.amount ELSE 0 END), 0)::bigint AS outflows
     FROM payments p
     WHERE p.company_id = $1 AND p.is_deleted = false
       AND COALESCE(p.status, 'posted') = 'posted'
       AND p.payment_type NOT IN ('bank_deposit', 'bank_withdrawal')
       AND p.payment_date >= $2::date AND p.payment_date <= $3::date`,
    [companyId, from, to],
  );

  const expRes = await query(
    `SELECT COALESCE(SUM(total_amount), 0)::bigint AS total
     FROM expenses
     WHERE company_id = $1 AND is_deleted = false
       AND expense_date >= $2::date AND expense_date <= $3::date`,
    [companyId, from, to],
  );

  const investRes = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN jel.debit > jel.credit THEN jel.debit - jel.credit ELSE 0 END), 0)::bigint AS outflows,
       COALESCE(SUM(CASE WHEN jel.credit > jel.debit THEN jel.credit - jel.debit ELSE 0 END), 0)::bigint AS inflows
     FROM journal_entry_lines jel
     JOIN journal_entries j ON j.id = jel.entry_id AND j.company_id = jel.company_id
     JOIN accounts a ON a.id = jel.account_id AND a.company_id = jel.company_id
     WHERE jel.company_id = $1 AND a.is_deleted = false
       AND j.status = 'posted' AND j.is_deleted = false
       AND LOWER(a.account_type) = 'asset'
       AND (
         LOWER(a.name) LIKE '%fixed%'
         OR LOWER(a.name) LIKE '%plant%'
         OR LOWER(a.name) LIKE '%equipment%'
         OR LOWER(a.name) LIKE '%machinery%'
         OR UPPER(COALESCE(a.code, '')) LIKE 'FA%'
       )
       AND j.entry_date >= $2::date AND j.entry_date <= $3::date`,
    [companyId, from, to],
  );

  const loanRes = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN transaction_type = 'disbursement' THEN amount ELSE 0 END), 0)::bigint AS inflows,
       COALESCE(SUM(CASE WHEN transaction_type IN ('repayment', 'interest') THEN amount ELSE 0 END), 0)::bigint AS outflows
     FROM loan_transactions
     WHERE company_id = $1
       AND transaction_date >= $2::date AND transaction_date <= $3::date`,
    [companyId, from, to],
  );

  const operatingLines: CashFlowLine[] = [
    { label: 'Customer receipts & incoming payments', amount_paise: Number(payRes.rows[0]?.inflows || 0), direction: 'inflow' },
    { label: 'Supplier & outgoing payments', amount_paise: Number(payRes.rows[0]?.outflows || 0), direction: 'outflow' },
    { label: 'Operating expenses (booked)', amount_paise: Number(expRes.rows[0]?.total || 0), direction: 'outflow' },
  ];

  const investingLines: CashFlowLine[] = [
    { label: 'Fixed asset purchases (journal debits)', amount_paise: Number(investRes.rows[0]?.outflows || 0), direction: 'outflow' },
    { label: 'Fixed asset disposals (journal credits)', amount_paise: Number(investRes.rows[0]?.inflows || 0), direction: 'inflow' },
  ];

  const financingLines: CashFlowLine[] = [
    { label: 'Loan disbursements', amount_paise: Number(loanRes.rows[0]?.inflows || 0), direction: 'inflow' },
    { label: 'Loan repayments & interest', amount_paise: Number(loanRes.rows[0]?.outflows || 0), direction: 'outflow' },
  ];

  const operating = sectionFromLines(operatingLines);
  const investing = sectionFromLines(investingLines);
  const financing = sectionFromLines(financingLines);

  return {
    period: { from, to },
    operating,
    investing,
    financing,
    net_change_paise: operating.net_paise + investing.net_paise + financing.net_paise,
    implemented: true,
  };
}
