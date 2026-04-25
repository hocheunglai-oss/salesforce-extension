import { format } from 'date-fns';

const BUYER_FIELD = 'Total_Invoice_Amount__c';
const SUPPLIER_FIELD = 'Total_Invoiced_Amount_From_Suppliers__c';
const COSTS_FIELD = 'Costs_Total__c';
const DELIVERY_FIELD = 'Delivery_Date__c';

// Custom display labels for specific fields
const FIELD_LABELS = {
  [BUYER_FIELD]: 'Buyer Invoice Amount',
  [SUPPLIER_FIELD]: 'Supplier Invoice Amount',
  'Costs_Total__c': 'Total Costs',
  'Buyer_Name__c': 'Buyer',
  'Buyer__c': 'Buyer',
};

const fmtMoney = (val) => {
  if (val == null) return '—';
  return `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const fmtVal = (key, val) => {
  if (val == null || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (key === BUYER_FIELD || key === SUPPLIER_FIELD || key === COSTS_FIELD || key.toLowerCase().includes('amount') || key.toLowerCase().includes('invoice') || key.toLowerCase().includes('price')) {
    const n = Number(val);
    if (!isNaN(n)) return fmtMoney(n);
  }
  if (key.toLowerCase().includes('date')) {
    try { return format(new Date(val), 'dd MMM yyyy'); } catch { return val; }
  }
  if (typeof val === 'number') return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const s = String(val);
  return s.length > 50 ? s.slice(0, 48) + '…' : s;
};

const colLabel = (key) => {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key.replace(/__c$/i, '').replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
};

export default function PnlTable({ records = [] }) {
  if (!records.length) return (
    <div className="text-center py-8 text-muted-foreground text-sm">No records</div>
  );

  const allCols = Object.keys(records[0]).filter(k => k !== 'Id');

  const hasBuyer = allCols.includes(BUYER_FIELD);
  const hasSupplier = allCols.includes(SUPPLIER_FIELD);
  const hasCosts = allCols.includes(COSTS_FIELD);
  const showPnl = hasBuyer && hasSupplier;

  // Build display column order; inject Total Costs after Supplier, then P&L after Costs (or after Supplier)
  const displayCols = [];
  allCols.forEach(col => {
    displayCols.push(col);
    if (col === SUPPLIER_FIELD) {
      // If costs column exists in data it will be pushed naturally after supplier
      // but if not in allCols we skip; handled below
    }
  });

  // Inject __pnl__ after COSTS_FIELD if present, else after SUPPLIER_FIELD
  const pnlAnchor = hasCosts ? COSTS_FIELD : SUPPLIER_FIELD;
  const anchorIdx = displayCols.indexOf(pnlAnchor);
  if (showPnl && anchorIdx !== -1) {
    displayCols.splice(anchorIdx + 1, 0, '__pnl__');
  } else if (showPnl && !displayCols.includes('__pnl__')) {
    displayCols.push('__pnl__');
  }

  const rightAligned = new Set([BUYER_FIELD, SUPPLIER_FIELD, COSTS_FIELD, '__pnl__']);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {displayCols.map(col => (
              <th
                key={col}
                className={`py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${
                  rightAligned.has(col) ? 'text-right' : 'text-left'
                }`}
              >
                {col === '__pnl__' ? 'P&L' : colLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((row, i) => {
            const buyer = row[BUYER_FIELD] ?? null;
            const supplier = row[SUPPLIER_FIELD] ?? null;
            const costs = row[COSTS_FIELD] ?? null;
            const hasDelivery = !!row[DELIVERY_FIELD];
            const pnl = showPnl && hasDelivery && buyer != null && supplier != null
              ? buyer - supplier - (costs ?? 0)
              : null;
            const pnlPositive = pnl != null && pnl >= 0;

            return (
              <tr key={row.Id || i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                {displayCols.map(col => {
                  if (col === '__pnl__') {
                    return (
                      <td key="__pnl__" className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${
                        pnl == null ? 'text-muted-foreground' : pnlPositive ? 'text-emerald-600' : 'text-red-500'
                      }`}>
                        {pnl == null
                          ? (showPnl && !hasDelivery ? <span className="text-muted-foreground/50 text-xs">no delivery</span> : '—')
                          : fmtMoney(pnl)}
                      </td>
                    );
                  }
                  return (
                    <td key={col} className={`py-2.5 px-3 whitespace-nowrap ${rightAligned.has(col) ? 'text-right text-foreground' : 'text-foreground'}`}>
                      {fmtVal(col, row[col])}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}