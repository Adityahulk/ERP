import assert from 'node:assert/strict';
import { ewayBillSettingsError } from '../services/ewayBillEligibility';

const withoutIrn = { irn: null, einvoice_status: 'not_applicable' };
const thresholdCompany = { einvoice_turnover_above_5cr: false, eway_bill_only_above_50k: true };

assert.equal(ewayBillSettingsError(thresholdCompany, { ...withoutIrn, total_amount: 4_999_999 })?.includes('₹50,000'), true);
assert.equal(ewayBillSettingsError(thresholdCompany, { ...withoutIrn, total_amount: 5_000_000 }), null);
assert.equal(ewayBillSettingsError(thresholdCompany, { ...withoutIrn, total_amount: 5_000_001 }), null);
assert.equal(ewayBillSettingsError({ einvoice_turnover_above_5cr: false }, { ...withoutIrn, total_amount: 1_000_000 }), null);

const applicableCompany = { einvoice_turnover_above_5cr: true, eway_bill_only_above_50k: true };
assert.equal(ewayBillSettingsError(applicableCompany, { ...withoutIrn, total_amount: 5_000_000 })?.includes('IRN'), true);
assert.equal(ewayBillSettingsError(applicableCompany, { irn: 'IRN123', einvoice_status: 'cancelled', total_amount: 5_000_000 })?.includes('IRN'), true);
assert.equal(ewayBillSettingsError(applicableCompany, { irn: 'IRN123', einvoice_status: 'generated', total_amount: 5_000_000 }), null);

console.log('E-Way Bill standalone, IRN, and exact ₹50,000 eligibility checks passed.');
