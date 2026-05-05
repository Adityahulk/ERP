# ERP Robustness Smoke Checklist

Use this checklist before each production deploy and after hotfixes touching sales, purchases, parties, stock, labeling, registration, or invoice PDFs.

## 1) Parties
- Create a new party from quick-add in sales and purchases.
- Open the created party detail page and confirm it loads.
- Edit the same party and verify changed fields persist.
- Validate error behavior:
  - invalid party URL -> "Invalid party link"
  - deleted/unknown UUID -> "Party not found"

## 2) Opening Stock
- Create a new inventory item with opening stock > 0 and a selected godown.
- Confirm quantity appears in:
  - item list total stock
  - item detail stock section
  - stock/godown screen
- Bulk import with opening stock and confirm stock movements are created.
- Run drift query (should return 0 rows):

```sql
SELECT i.id, i.name, i.opening_stock, COALESCE(s.qty,0) AS ledger_qty
FROM items i
LEFT JOIN (
  SELECT item_id, SUM(quantity) AS qty
  FROM item_stock
  GROUP BY item_id
) s ON s.item_id = i.id
WHERE i.is_deleted = false
  AND COALESCE(i.opening_stock,0) > 0
  AND COALESCE(s.qty,0) <= 0;
```

## 3) Labels and Barcode Printing
- Open item detail -> Print Labels.
- Verify modes:
  - General printer (24/40/65 per page)
  - Label printer (1-up / 2-up)
- Confirm label printer flow only prints one selected item payload.
- Generate PDF for each mode and verify readable barcode + rupee pricing.

## 4) Money Unit Safety (Rupees UX, Paise storage)
- Enter `200.00` in sales line item rate and ensure preview/PDF shows `₹200.00`.
- Enter OCR total `200.00` and ensure payload stores paise (`20000`).
- Validate purchase bill and invoice totals remain correct in:
  - table rows
  - totals card
  - generated PDF

## 5) Registrant Dashboard and Licenses
- Login via `/register/login` and open `/register/dashboard`.
- Refresh page and verify route stays accessible (token hydration works).
- Confirm multiple licenses are listed under the same registrant account.
- Verify company data remains isolated per company login.

## 6) Invoice Branding and Theme
- Generate invoices for classic, modern, and compact themes.
- Confirm logo, company name, address, and signature are rendered.
- Validate logo/signature URLs work for both absolute and relative paths.

## 7) Build and Runtime
- Backend: `npm run build` passes.
- Frontend: `npm run build` passes.
- Validate server logs have no new 500s for:
  - `/parties/:id`
  - `/labels/bulk`
  - `/register/me`
  - invoice PDF generation endpoints
