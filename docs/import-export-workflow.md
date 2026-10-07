# Import and Export Workflow

## Items and branch stock

Open Settings > Data Management > Item Masters (or Items > Import Items).
Select the active target godown, then upload the file. Both entry points use the
same preview and confirmation flow.

- Unnumbered rows are grouped by item identity and target godown. Existing
  unnumbered items are reused; an item that only exists as a numbered unit does
  not prevent creating its unnumbered bulk-stock counterpart.
- Existing duplicate masters are matched using Item ID, SKU or barcode, or a
  unique existing stock record in the selected godown. If still ambiguous,
  select a record in the preview. The choices show current branch quantities.
  Apply the choice using Recheck selections.
- Identical physical serial rows in one file are counted once. Conflicting
  quantities for the same physical serial require correction.
- A physical serial already available in the same branch is reused without
  adding another unit. A serial in a different branch requires an explicit
  keep/transfer selection and transfer confirmation. Transfers update both
  branch balances and write stock movement records in one transaction.
- A serial-column value attached to multiple units is preserved as a bulk item
  reference. Exported files distinguish Serial No from Serial Reference.
  Converting a previously imported physical-serial record into a bulk reference
  requires explicit confirmation. Sold/reserved records and masters with
  multiple physical serials cannot be converted through this flow.
- Missing prices/GST are zero for new masters. Existing master prices and taxes
  are retained. A missing quantity does not reset an existing balance. An
  explicitly supplied zero quantity sets unnumbered stock to zero in the target
  branch, subject to reservations.
- Importing an existing unnumbered item's quantity sets that branch's balance;
  it does not add the quantity again on retries or change other branches.

Errors are visible before saving and downloadable as CSV. Saving valid records
while leaving invalid records unchanged requires an explicit checkbox. A stale
preview returns HTTP 409 with refreshed results and performs no import writes.
Every import is transactional; a failed write rolls back its stock and masters.

## Other imports

Purchase bills have a target godown selector. Inventory-tracked items must have
a valid godown, and ambiguous party/item names require GSTIN, SKU or exported
IDs. Repeated rows of a bill must agree on supplier, date and godown. Discounts,
tax rates, quantities and currency values are validated before posting.
Serial-tracked purchases should use the Purchase Bill form to record each unit.

Party and expense exports include stable IDs. Re-importing those existing IDs
keeps the original records and ledgers. Expense imports without references receive
a deterministic import reference, so an identical file retry does not post the
expense again. Cash/bank imports set target balances and post only the difference.

The Tally bridge accepts JSON/XML master files, shows a preview, and requires
confirmation. Opening stock needs a selected godown. It handles units, parties
and items; it does not restore all Tally vouchers. ERP Tally JSON money values are
in paise; external JSON can specify `money_unit: "rupees"` explicitly.

## Exports

Export data downloads Excel files for items, godown stock, parties, purchases,
expenses and cash/bank balances. All matching records are included, with currency
in rupees and IDs/serial values preserved as text. Branch exports retain the
godown on each row. A file naming a different branch is rejected rather than
silently assigning its stock to the selected branch.

Company Data Export downloads a consistent JSON snapshot of company-scoped
records and transaction details, including stock and accounting history.
It is not restricted by listing-page pagination. Currency is in paise; password,
token and provider-secret fields are excluded. This data snapshot is not a
one-click restore file. Use the dataset Excel exports for supported re-imports.

## Deploy and Verify

Deploy the updated backend and frontend together, then reload the browser and
upload the file again. Older frontend bundles cannot confirm an import without
the new reviewed-preview hash. This change adds no database migration.

```sh
cd backend
npm ci
npm run build
npm run test:import-export
npm run test:item-import-godowns
npm run test:stock-import-godown
```

The import/export regression suite creates an isolated PostgreSQL database in
memory and applies the production SQL migrations. It does not connect to the
configured client database. PGlite is a development-only dependency.

```sh
cd frontend
npm ci
npm run build
npm run dev -- --host 127.0.0.1 --port 3000
```

With the frontend running, the browser regression check uses test API responses:

```sh
node scripts/import-workflow-ui.cjs
```
