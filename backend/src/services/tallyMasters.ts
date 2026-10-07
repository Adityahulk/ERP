import { XMLParser } from 'fast-xml-parser';
import { importNumber } from './importFile';

const array = (value: any): any[] => value == null ? [] : Array.isArray(value) ? value : [value];

export function readTallyMasters(content: string, extension: string) {
  if (extension === 'json') {
    const body = JSON.parse(content);
    const data = body?.data ?? body;
    if (data.backup_format) throw new Error('Use a Tally master export, not a company data backup');
    if (![data.units, data.items, data.parties].some(Array.isArray)) throw new Error('JSON must contain Tally units, items or parties arrays');
    const divisor = data.money_unit === 'rupees' ? 1 : 100;
    return { units: array(data.units), parties: array(data.parties).map((party) => ({ ...party, opening_balance: importNumber(party.opening_balance) / divisor })),
      items: array(data.items).map((item) => ({ 'Name': item.name, 'SKU': item.sku || '', 'Barcode': item.barcode || '',
        'HSN Code': item.hsn_code || '', 'GST Rate': item.gst_rate || 0, 'Item Type': item.item_type || 'product',
        'Selling Price': importNumber(item.selling_price) / divisor, 'Purchase Price': importNumber(item.purchase_price) / divisor,
        'Opening Stock': item.opening_stock || 0, 'Serial No': item.serial_number || '' })) };
  }
  if (extension !== 'xml') throw new Error('Choose a Tally JSON or XML file');
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false }).parse(content);
  const messages = array(parsed?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE ?? parsed?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE);
  if (!messages.length) throw new Error('No Tally master records were found in this XML');
  return {
    units: messages.flatMap((message) => array(message.UNIT)).map((unit) => ({ name: unit.NAME, abbreviation: unit.ORIGINALNAME || '' })),
    parties: messages.flatMap((message) => array(message.LEDGER)).map((party) => ({ name: party.NAME, gstin: party.GSTIN || '', opening_balance: 0 })),
    items: messages.flatMap((message) => array(message.STOCKITEM)).map((item) => ({ 'Name': item.NAME,
      'GST Rate': item.RATEOFTAXCALCULATION || 0, 'Opening Stock': importNumber(String(item.OPENINGBALANCE || '0').match(/^-?\d+(?:\.\d+)?/)?.[0]),
    })),
  };
}
