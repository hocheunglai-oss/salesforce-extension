import { format } from 'date-fns';

const BUYER_FIELD = 'Total_Invoice_Amount__c';
const SUPPLIER_FIELD = 'Total_Invoiced_Amount_From_Suppliers__c';
const COSTS_FIELD = 'Costs_Total__c';
const DELIVERY_FIELD = 'Delivery_Date__c';

// Custom display labels
const FIELD_LABELS = {
  [BUYER_FIELD]: 'Buyer Invoice',
  [SUPPLIER_FIELD]: 'Supplier Invoice',
  'Costs_Total__c': 'Total Costs',
  '_buyerBrokerName': 'Buyer Broker',
  '_buyerBrokerComm': 'Buyer Broker Comm',
  '_suppBrokerName': 'Supplier Broker',
  '_suppBrokerComm': 'Supplier Broker Comm',
};

// Columns to completely hide (used only for internal P&L calc)
const HIDDEN_COLS = new Set(['__buyerCommCalc', '__suppCommPerUnitCalc', '__netPnlCalc', 'Buyer_Name__c', 'Buyer__c', 'KeyStem__c', '_buyerBrokerName', '_buyerBrokerComm', '_suppBrokerName', '_suppBrokerComm']);

// Columns that are right-aligned (money)
const MONEY_COLS = new Set([BUYER_FIELD, SUPPLIER_FIELD, COSTS_FIELD, '_buyerBrokerComm', '_suppBrokerComm', '__pnl__']);

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
  'Delivery_Date__c',
  'CreatedDate',
  BUYER_FIELD,
  SUPPLIER_FIELD,
  COSTS_FIELD,
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

  const hasBuyer = rawCols.includes(BUYER_FIELD);
  const hasSupplier = rawCols.includes(SUPPLIER_FIELD);
  const showPnl = hasBuyer && hasSupplier;

  // Build ordered display cols
  const colSet = new Set(rawCols);
  const displayCols = [
    ...COL_ORDER.filter(c => c === '__pnl__' ? showPnl : colSet.has(c)),
    ...rawCols.filter(c => !COL_ORDER.includes(c)), // any extras not in order list
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {displayCols.map(col => (
              <th
                 key={col}
                 className={`py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${
                   MONEY_COLS.has(col) ? 'text-right' : 'text-left'
                 }`}
               >
                 {col === '__pnl__' ? 'Net P&L' : colLabel(col)}
               </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((row, i) => {
            const buyer = row[BUYER_FIELD] ?? null;
            const supplier = row[SUPPLIER_FIELD] ?? null;
            const hasDelivery = !!row[DELIVERY_FIELD];
            const buyerCommCalc = row.__buyerCommCalc ?? 0;
            const suppCommPerUnitCalc = row.__suppCommPerUnitCalc ?? 0;
            const pnl = showPnl && hasDelivery
              ? (row.__netPnlCalc != null ? row.__netPnlCalc : (!buyer || !supplier ? 0 : buyer - supplier - suppCommPerUnitCalc - buyerCommCalc))
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
                        {pnl == null
                           ? (showPnl && !hasDelivery ? <span className="text-muted-foreground/50 text-xs">no delivery</span> : '—')
                           : fmtMoney(pnl)}
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