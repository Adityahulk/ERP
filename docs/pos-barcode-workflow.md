# POS Barcode and Thermal Printing Workflow

## One-time setup

1. Create at least one active godown.
2. Create the item with a name, selling price, GST rate, unit, and inventory tracking as required.
3. Put opening stock in the godown that will be used at the POS counter.
4. Install the thermal printer's operating-system driver and print a system test page.
5. In Settings > Print, select Thermal 58 mm or Thermal 80 mm.
6. For silent/direct printing, install and start QZ Tray, connect it in Settings > Print, select the system printer, enable Direct POS printing, and save.

Direct printing is a per-computer preference. If QZ Tray is unavailable, POS opens the normal browser print dialog instead.

## Generate or reprint an item barcode

1. Open Generate Barcode.
2. Search for and select an existing item.
3. The system restores that item's last saved label size, visible fields, quantity, price mode, and barcode source.
4. Keep System barcode to reuse the permanent generated code, use SKU when the item SKU is the printed code, or enter a Custom barcode supplied by a vendor.
5. Choose A4 or the supported thermal label size, set the label count, preview, and generate/print the PDF.

Generating a label registers the printed code against the item. Searching the same item later restores its saved label profile. System barcodes remain stable, so reprinting does not create a different product identity.

## POS sale

1. Open POS Billing and select the selling godown.
2. Focus may remain anywhere on the POS screen. A USB/Bluetooth scanner operating in keyboard/HID mode can scan a Code 128/EAN label and finish with Enter or Tab.
3. A scan resolves the system barcode, SKU, or registered custom barcode and adds one unit to the cart.
4. Scanning the same item again increments its cart quantity by one. Quantity can also be edited manually, including decimal quantities where the item permits them.
5. POS blocks quantities above available stock in the selected godown.
6. Select Cash, Card, UPI, or Credit. For cash, enter the tendered amount to calculate change.
7. Confirm with the button, `F10`, or `Ctrl+Enter`.
8. Invoice creation, payment recording, accounting entries, stock deduction, and stock movement creation happen in one database transaction. If any part fails, the whole checkout rolls back.
9. After success, the thermal receipt opens. With direct printing enabled it is sent to the configured printer automatically; otherwise the browser print dialog opens.

Stock is deducted only after invoice creation succeeds, not when an item is merely scanned into an unfinished cart.

## Hardware requirements

- Barcode scanner: USB or Bluetooth model supporting keyboard/HID mode and an Enter or Tab suffix.
- Supported codes: saved system barcode, item SKU, and registered custom label barcode.
- Thermal receipt printer: an operating-system-visible 58 mm or 80 mm printer.
- Direct printing: QZ Tray running on the billing computer.
- Camera/mobile scanning: camera permission and a clear, well-lit barcode; mobile wireless scanning requires the phone and POS computer to reach the same running application.

## Deployment requirement

Run database migrations before deploying the POS/barcode changes:

```bash
cd backend
npm run build
npm run migrate
```

Migration `051_pos_barcode_workflow.sql` adds company-scoped barcode aliases and saved label profiles.
