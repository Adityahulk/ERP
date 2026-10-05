type EwayBillCompanySettings = {
  einvoice_turnover_above_5cr?: boolean | null;
  eway_bill_only_above_50k?: boolean | null;
};

type EwayBillInvoice = {
  irn?: string | null;
  einvoice_status?: string | null;
  total_amount?: number | string | null;
};

export function ewayBillSettingsError(
  company: EwayBillCompanySettings,
  invoice: EwayBillInvoice,
): string | null {
  if (company.einvoice_turnover_above_5cr && !(invoice.irn && invoice.einvoice_status === 'generated')) {
    return 'This company is marked as e-invoice applicable. Generate an IRN before creating its E-Way Bill.';
  }
  if (company.eway_bill_only_above_50k && Number(invoice.total_amount || 0) < 5000000) {
    return 'Company setting allows E-Way Bill generation only for invoices of ₹50,000 or more.';
  }
  return null;
}
