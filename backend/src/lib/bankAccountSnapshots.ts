/** Resolved bank columns for invoices / purchase_invoices INSERT (snapshots keep PDF stable). */

import type { QueryResult } from 'pg';

export type BankSnapshotInsert = {
  company_bank_account_id: string | null;
  bank_label_snapshot: string | null;
  bank_name_snapshot: string | null;
  bank_account_number_snapshot: string | null;
  bank_ifsc_snapshot: string | null;
  bank_branch_snapshot: string | null;
  upi_id_snapshot: string | null;
};

/** Pool `query` / transaction `client.query` */
export type Queryable = { query: (text: string, params?: any[]) => Promise<QueryResult> };

const emptySnapshots = (): BankSnapshotInsert => ({
  company_bank_account_id: null,
  bank_label_snapshot: null,
  bank_name_snapshot: null,
  bank_account_number_snapshot: null,
  bank_ifsc_snapshot: null,
  bank_branch_snapshot: null,
  upi_id_snapshot: null,
});

export async function resolveBankSnapshotsForInsert(
  db: Queryable,
  companyId: string,
  companyBankAccountId: string | null | undefined,
): Promise<BankSnapshotInsert> {
  if (!companyBankAccountId || typeof companyBankAccountId !== 'string') {
    return emptySnapshots();
  }
  const r = await db.query(
    `SELECT id, account_label, bank_name, account_number, ifsc, branch, upi_id
     FROM company_bank_accounts
     WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
    [companyBankAccountId, companyId],
  );
  const row = r.rows[0];
  if (!row) throw new Error('Invalid bank account reference');
  return {
    company_bank_account_id: String(row.id),
    bank_label_snapshot: row.account_label ? String(row.account_label) : null,
    bank_name_snapshot: row.bank_name ? String(row.bank_name) : null,
    bank_account_number_snapshot: row.account_number != null ? String(row.account_number) : null,
    bank_ifsc_snapshot: row.ifsc ? String(row.ifsc) : null,
    bank_branch_snapshot: row.branch ? String(row.branch) : null,
    upi_id_snapshot: row.upi_id ? String(row.upi_id) : null,
  };
}

function hasAnyInvoiceBankSnapshot(inv: Record<string, unknown>): boolean {
  return (
    inv.bank_name_snapshot != null ||
    inv.bank_account_number_snapshot != null ||
    inv.bank_ifsc_snapshot != null ||
    inv.bank_branch_snapshot != null ||
    inv.upi_id_snapshot != null ||
    inv.bank_label_snapshot != null
  );
}

/** Merge company row + optional primary bank row for PDF; prefer invoice snapshots, then linked account, then primary. */
export async function resolveCompanyRowForInvoicePdf(
  db: Queryable,
  companyId: string,
  companyRow: Record<string, unknown>,
  invRow: Record<string, unknown>,
  primaryBankRow: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  if (hasAnyInvoiceBankSnapshot(invRow)) {
    return {
      ...companyRow,
      bank_name: invRow.bank_name_snapshot ?? companyRow.bank_name,
      bank_account_number: invRow.bank_account_number_snapshot ?? companyRow.bank_account_number,
      bank_ifsc: invRow.bank_ifsc_snapshot ?? companyRow.bank_ifsc,
      bank_branch: invRow.bank_branch_snapshot ?? companyRow.bank_branch,
      upi_id: invRow.upi_id_snapshot ?? companyRow.upi_id,
    };
  }
  const linkId = invRow.company_bank_account_id;
  if (linkId) {
    const r = await db.query(
      `SELECT bank_name, account_number, ifsc, branch, upi_id
       FROM company_bank_accounts
       WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [linkId, companyId],
    );
    const b = r.rows[0];
    if (b) {
      return {
        ...companyRow,
        bank_name: b.bank_name ?? companyRow.bank_name,
        bank_account_number: b.account_number ?? companyRow.bank_account_number,
        bank_ifsc: b.ifsc ?? companyRow.bank_ifsc,
        bank_branch: b.branch ?? companyRow.bank_branch,
        upi_id: b.upi_id || companyRow.upi_id,
      };
    }
  }
  if (primaryBankRow) {
    return {
      ...companyRow,
      bank_name: primaryBankRow.bank_name,
      bank_account_number: primaryBankRow.account_number,
      bank_ifsc: primaryBankRow.ifsc,
      bank_branch: primaryBankRow.branch,
      upi_id: primaryBankRow.upi_id || companyRow.upi_id,
    };
  }
  return companyRow;
}
