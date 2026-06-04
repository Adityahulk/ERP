import { LabelTemplate, LabelData, LabelField } from '@/types';
import { getApiBaseURL } from '@/lib/api';

export function renderField(
  field: LabelField | string | undefined | null,
  currency: 'INR' | 'USD' | 'EUR' = 'INR',
  isPreview = false
): { text: string; style: React.CSSProperties } | null {
  if (!field) return null;

  let val = '';
  let type: 'plain' | 'currency' = 'plain';
  let style: 'normal' | 'cross' | 'empty' = 'normal';
  let format = { bold: false, italic: false, underline: false };
  let placeholder = '';
  let align: 'left' | 'center' | 'right' = 'center';

  if (typeof field === 'string') {
    val = field;
  } else {
    val = field.value ?? '';
    type = field.type || 'plain';
    style = field.style || 'normal';
    format = field.format || { bold: false, italic: false, underline: false };
    placeholder = field.placeholder ?? '';
    align = field.align || 'center';
  }

  if (style === 'empty') return null;

  // Placeholder system (preview only)
  if (!val) {
    if (isPreview && placeholder) {
      return {
        text: placeholder,
        style: {
          color: '#aaa',
          fontStyle: 'italic',
          textAlign: align,
        },
      };
    }
    return null;
  }

  let displayText = val;
  if (type === 'currency') {
    const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';
    displayText = `${symbol}${val}`;
  }

  const cssStyle: React.CSSProperties = {
    textAlign: align,
  };

  if (style === 'cross') {
    cssStyle.color = 'gray';
  }

  const decorations: string[] = [];
  if (style === 'cross') {
    decorations.push('line-through');
  }
  if (format.underline) {
    decorations.push('underline');
  }
  if (decorations.length > 0) {
    cssStyle.textDecoration = decorations.join(' ');
  }

  if (format.bold) {
    cssStyle.fontWeight = 'bold';
  }
  if (format.italic) {
    cssStyle.fontStyle = 'italic';
  }

  return {
    text: displayText,
    style: cssStyle,
  };
}

export function getPriceFontSize(priceText: string): string {
  const len = (priceText || '').length;
  if (len <= 8) return '14px';
  if (len <= 10) return '13px';
  if (len <= 12) return '12px';
  if (len <= 14) return '11px';
  return '10px';
}

export function LabelRenderer({
  template: _template,
  data
}: {
  template: LabelTemplate;
  data: LabelData;
}) {
  const apiBase = getApiBaseURL();

  // Ensure all fields exist
  const line1 = data.line1;
  const line2 = data.line2;
  const line3 = data.line3;
  const line4 = data.line4;
  const line5 = data.line5;
  const line6 = data.line6;
  const priceField = data.price;

  const isBarcodeOnly =
    line1?.style === 'empty' &&
    line2?.style === 'empty' &&
    line3?.style === 'empty' &&
    line4?.style === 'empty' &&
    line5?.style === 'empty' &&
    line6?.style === 'empty' &&
    priceField?.style === 'empty';

  const showBc = data.showBarcode || isBarcodeOnly;

  // Resolve barcode value based on source toggle
  const barcodeValue = data.barcodeSource === 'custom' ? data.customBarcodeValue : data.barcodeValue;

  // Render price field override
  const renderedPrice = renderField(priceField, data.currency, true);

  // Resolve sizing: printMode (from LabelConfig) overrides template for PDF print.
  // When used in TemplatePicker or live preview without a printMode, use the template dims.
  let width = '220px';
  let height = '140px';

  const printMode = (data as any).printMode;
  if (printMode === 'thermal_double') {
    width = '210px';
    height = '142px';
  } else if (printMode === 'thermal_single') {
    width = '368px';
    height = '180px';
  } else if (printMode === 'a4_24') {
    width = '175px';
    height = '168px';
  } else if (printMode === 'a4_40') {
    width = '145px';
    height = '130px';
  } else if (printMode === 'a4_65') {
    width = '148px';
    height = '80px';
  } else if (_template) {
    // No printMode override — use the selected template's dimensions
    width = `${_template.width}px`;
    height = `${_template.height}px`;
  }


  const density = printMode === 'a4_65' ? 'tight' : printMode === 'a4_40' ? 'compact' : 'roomy';
  const showCompany = density !== 'tight';

  return (
    <div
      className="label"
      style={{
        position: 'relative',
        width: width,
        height: height,
        border: '1px solid #ccc',
        background: '#fff',
        overflow: 'hidden',
        boxSizing: 'border-box',
        fontFamily: 'Arial, Helvetica, sans-serif',
        pageBreakInside: 'avoid',
        breakInside: 'avoid',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px',
        gap: '0px'
      }}
    >
      {/* 1. TOP SECTION (GRID CONTROL) */}
      {!isBarcodeOnly && (
        <div
          className="top-section"
          style={{
            width: '100%',
            flex: '0 1 auto',
            maxHeight: '55%',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            boxSizing: 'border-box'
          }}
        >
          {/* Brand name */}
          {showCompany && data.brandName && (
            <div
              style={{
                width: '100%',
                fontSize: '9px',
                fontWeight: 'bold',
                color: '#555',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginBottom: '2px'
              }}
            >
              {data.brandName}
            </div>
          )}

          {/* 3 COLUMN TEXT GRID (line1 - line6) */}
          <div
            className="grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '1px',
              width: '100%',
              fontSize: '9px',
              lineHeight: '1.1'
            }}
          >
            {[
              { key: 'line1', field: line1 },
              { key: 'line2', field: line2 },
              { key: 'line3', field: line3 },
              { key: 'line4', field: line4 },
              { key: 'line5', field: line5 },
              { key: 'line6', field: line6 }
            ].map((item) => {
              const rendered = renderField(item.field, data.currency, true);
              if (!rendered) return <div key={item.key} style={{ minWidth: 0 }} />; // Keep grid place empty
              
              const itemStyle: React.CSSProperties = {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                width: '100%',
                fontSize: '9px',
                lineHeight: '1.1',
                minWidth: 0,
                // Do NOT set textAlign here — let rendered.style (user align) win
                ...rendered.style
              };

              return (
                <div key={item.key} style={itemStyle}>
                  {rendered.text}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. MIDDLE SECTION (PRICE - LOCKED) */}
      {!isBarcodeOnly && renderedPrice && (
        <div
          className="middle-section"
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            margin: '1px 0',
            flexShrink: 0
          }}
        >
          <div
            className="price"
            style={{
              fontWeight: 'bold',
              fontSize: getPriceFontSize(renderedPrice.text),
              whiteSpace: 'nowrap',
              ...renderedPrice.style
            }}
          >
            {renderedPrice.text}
          </div>
        </div>
      )}

      {/* 3. BOTTOM SECTION (BARCODE - ANCHORED) */}
      {showBc && (
        <div
          className="bottom-section"
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <div
            className="barcode-wrapper"
            style={{
              background: '#fff',
              padding: '2px',
              width: '90%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box'
            }}
          >
            {barcodeValue ? (
              <img
                src={`${apiBase}/barcode?text=${encodeURIComponent(barcodeValue)}&includetext=false`}
                alt="barcode"
                style={{
                  display: 'block',
                  width: '100%',
                  maxWidth: '150px',
                  height: '32px',
                  objectFit: 'contain'
                }}
              />
            ) : (
              <div
                style={{
                  width: '150px',
                  height: '40px',
                  background: 'repeating-linear-gradient(90deg,#333 0,#333 2px,#fff 2px,#fff 5px)',
                  opacity: 0.4
                }}
              />
            )}
            {/* Barcode text (rendered manually with toggle) */}
            {data.showBarcodeText && (
              <div style={{ fontSize: '9px', color: '#555', marginTop: '2px', textAlign: 'center' }}>
                {barcodeValue || 'N/A'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
