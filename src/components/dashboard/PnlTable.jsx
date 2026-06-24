import { format } from 'date-fns';

const BUYER_FIELD = 'Total_Invoice_Amount__c';
const SUPPLIER_FIELD = 'Total_Invoiced_Amount_From_Suppliers__c';
const COSTS_FIELD = 'Costs_Total__c';
const DELIVERY_FIELD = 'Delivery_Date__c';

// Custom display labels
const FIELD_LABELS = {
  [BUYER_FIELD]: 'Buyer Invoice',
  [SUPPLIER_FIELD]: 'Supplier Invoice',
  'Buyer_Name__c': 'Buyer Name',
  'ETA_Start_Date__c': 'ETA',
  [DELIVERY_FIELD]: 'Delivery Date',
  '__extraCostBuyCalc': 'EXTRA COSTS',
  '_buyerBrokerName': 'Buyer Broker',
  '_buyerBrokerComm': 'Buyer Broker Comm',
  '_suppBrokerName': 'Supplier Broker',
  '_suppBrokerComm': 'Supplier Broker Comm',
};

// Columns to completely hide (some are still used behind the scenes for Gross Profit)
const HIDDEN_COLS = new Set([
  BUYER_FIELD,
  SUPPLIER_FIELD,
  COSTS_FIELD,
  'QLIK_STEM_Line_Item_Total_Cost__c',
  'QLIK_Costs_Total_Cost__c',
  '__extraCostBuyCalc',
  '__buyerCommCalc',
  '__suppCommPerUnitCalc',
  '__netPnlCalc',
  'Buyer__c',
  'KeyStem__c',
  '_buyerBrokerName',
  '_buyerBrokerComm',
  '_suppBrokerName',
  '_suppBrokerComm',
]);

// Columns that are right-aligned (money)
const MONEY_COLS = new Set([BUYER_FIELD, SUPPLIER_FIELD, COSTS_FIELD, '__extraCostBuyCalc', '_buyerBrokerComm', '_suppBrokerComm', '__pnl__']);

const fmtMoney = (val) => {
  if (val == null) return '—';
  return `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const fmtVal = (key, val) => {
  if (val == null || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (MONEY_COLS.has(key) || key.toLowerCase().includes('amount') || key.toLowerCase().includes('invoice') || key.toLowerCase().includes('price') || key === '_buyerBrokerComm' || key === '_suppBrokerComm') {
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

// Desired column order (columns not in this list are appended after)
const COL_ORDER = [
  'KeyStem__c',
  'Name',
  'Buyer_Name__c',
  'CreatedDate',
  'ETA_Start_Date__c',
  DELIVERY_FIELD,
  BUYER_FIELD,
  SUPPLIER_FIELD,
  '_buyerBrokerName',
  '_buyerBrokerComm',
  '_suppBrokerName',
  '_suppBrokerComm',
  '__pnl__',
];

export default function PnlTable({ records = [], onRowClick }) {
  if (!records.length) return (
    <div className="text-center py-8 text-muted-foreground text-sm">No records</div>
  );

  const rawCols = Object.keys(records[0]).filter(k => k !== 'Id' && !HIDDEN_COLS.has(k));

  const hasBuyer = Object.prototype.hasOwnProperty.call(records[0], BUYER_FIELD);
  const hasSupplier = Object.prototype.hasOwnProperty.call(records[0], SUPPLIER_FIELD);
  const showPnl = hasBuyer && hasSupplier;

  // Build ordered display cols
  const colSet = new Set(rawCols);
  const displayCols = [
    ...COL_ORDER.filter(c => c !== '__pnl__' && colSet.has(c)),
    ...rawCols.filter(c => !COL_ORDER.includes(c)), // any extras not in order list
    ...(showPnl ? ['__pnl__'] : []),
  ];

  return (
    <div className="max-h-[520px] overflow-auto rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {displayCols.map(col => (
              <th
                 key={col}
                 className={`sticky top-0 z-10 bg-card py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${
                   MONEY_COLS.has(col) ? 'text-right' : 'text-left'
                 }`}
               >
                 {col === '__pnl__' ? 'Gross Profit' : colLabel(col)}
               </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((row, i) => {
            const buyer = row[BUYER_FIELD] ?? null;
            const supplier = row[SUPPLIER_FIELD] ?? null;
            const pnl = showPnl
              ? (row.__netPnlCalc != null ? row.__netPnlCalc : (buyer == null || supplier == null ? null : buyer - supplier))
              : null;
            const pnlPositive = pnl != null && pnl >= 0;

            return (
              <tr
                key={row.Id || i}
                className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => onRowClick?.(row)}
              >
                {displayCols.map(col => {
                  if (col === '__pnl__') {
                    return (
                      <td key="__pnl__" className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${
                        pnl == null ? 'text-muted-foreground' : pnlPositive ? 'text-emerald-600' : 'text-red-500'
                      }`}>
                        {pnl == null ? '—' : fmtMoney(pnl)}
                      </td>
                    );
                  }
                  return (
                    <td key={col} className={`py-2.5 px-3 whitespace-nowrap ${MONEY_COLS.has(col) ? 'text-right text-foreground' : 'text-foreground'}`}>
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
