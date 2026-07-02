import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { compactTextValue, numericValue, textValue } from '@/lib/displayValue';

const BUYER_FIELD = 'Total_Invoice_Amount__c';
const SUPPLIER_FIELD = 'Total_Invoiced_Amount_From_Suppliers__c';
const COSTS_FIELD = 'Costs_Total__c';
const DELIVERY_FIELD = 'Delivery_Date__c';

// Custom display labels
const FIELD_LABELS = {
  [BUYER_FIELD]: 'Buyer Invoice',
  [SUPPLIER_FIELD]: 'Supplier Invoice',
  'Buyer_Name__c': 'Buyer Name',
  '_Buyer_Group': 'Buyer Group',
  '_Supplier_Names': 'Supplier Names',
  '_Product_Quantities': 'Products / Quantity',
  'ETA_Start_Date__c': 'ETA',
  [DELIVERY_FIELD]: 'Delivery Date',
  '__extraCostBuyCalc': 'EXTRA COSTS',
  '_buyerBrokerName': 'Buyer Broker',
  '_buyerBrokerComm': 'Buyer Broker Comm',
  '_suppBrokerName': 'Supplier Broker',
  '_suppBrokerComm': 'Supplier Broker Comm',
};

// Columns to completely hide (some are still used behind the scenes for Gross Profit)
const BASE_HIDDEN_COLS = new Set([
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
  'ETA_Start_Date__c',
  'Expected_Delivery_Date__c',
  'Dispute_Status__c',
  'Dispute__c',
  'Dispute_Type__c',
  'Dispute_Particular__c',
  '_buyerBrokerName',
  '_buyerBrokerComm',
  '_suppBrokerName',
  '_suppBrokerComm',
  '_Supplier_Name_List',
  '_Product_Quantity_List',
]);

// Columns that are right-aligned (money)
const MONEY_COLS = new Set([BUYER_FIELD, SUPPLIER_FIELD, COSTS_FIELD, '__extraCostBuyCalc', '_buyerBrokerComm', '_suppBrokerComm', '__pnl__']);

const fmtMoney = (val) => {
  const number = numericValue(val);
  if (number == null) return '—';
  return `$${number.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const fmtVal = (key, val) => {
  if (val == null || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (MONEY_COLS.has(key) || key.toLowerCase().includes('amount') || key.toLowerCase().includes('invoice') || key.toLowerCase().includes('price') || key === '_buyerBrokerComm' || key === '_suppBrokerComm') {
    const n = Number(val);
    if (!isNaN(n)) return fmtMoney(n);
  }
  if (key.toLowerCase().includes('date')) {
    if (typeof val === 'object') return textValue(val);
    try { return format(new Date(val), 'dd MMM yyyy'); } catch { return textValue(val); }
  }
  if (typeof val === 'number') return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return compactTextValue(val, 50);
};

const getPnl = (row) => {
  const buyer = row[BUYER_FIELD] ?? null;
  const supplier = row[SUPPLIER_FIELD] ?? null;
  if (row.__netPnlCalc != null) return row.__netPnlCalc;
  if (buyer == null || supplier == null) return null;
  return buyer - supplier;
};

const getSortValue = (row, key) => {
  if (key === '__pnl__') return getPnl(row);
  if (key === DELIVERY_FIELD) return row.Delivery_Date__c || row.Expected_Delivery_Date__c || null;
  return row[key];
};

const compareValues = (a, b, key, direction) => {
  const av = getSortValue(a, key);
  const bv = getSortValue(b, key);
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  const an = Number(av);
  const bn = Number(bv);
  if (!isNaN(an) && !isNaN(bn) && textValue(av, '').trim() !== '' && textValue(bv, '').trim() !== '') {
    return (an - bn) * direction;
  }
  return textValue(av).localeCompare(textValue(bv)) * direction;
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
  '_Buyer_Group',
  '_Supplier_Names',
  '_Product_Quantities',
  'CreatedDate',
  DELIVERY_FIELD,
  BUYER_FIELD,
  SUPPLIER_FIELD,
  '_buyerBrokerName',
  '_buyerBrokerComm',
  '_suppBrokerName',
  '_suppBrokerComm',
  '__pnl__',
];

export default function PnlTable({ records = [], onRowClick, counterpartyMode = 'buyer' }) {
  const [sortKey, setSortKey] = useState(DELIVERY_FIELD);
  const [sortDir, setSortDir] = useState(-1);
  const firstRecord = records[0] || {};
  const hiddenCols = useMemo(() => {
    const cols = new Set(BASE_HIDDEN_COLS);
    if (counterpartyMode === 'supplier') cols.add('Buyer_Name__c');
    else cols.add('_Supplier_Names');
    return cols;
  }, [counterpartyMode]);
  const rawCols = Object.keys(firstRecord).filter(k => k !== 'Id' && !hiddenCols.has(k));
  const hasBuyer = Object.prototype.hasOwnProperty.call(firstRecord, BUYER_FIELD);
  const hasSupplier = Object.prototype.hasOwnProperty.call(firstRecord, SUPPLIER_FIELD);
  const showPnl = hasBuyer && hasSupplier;

  // Build ordered display cols
  const colSet = new Set(rawCols);
  const displayCols = [
    ...COL_ORDER.filter(c => c !== '__pnl__' && colSet.has(c)),
    ...rawCols.filter(c => !COL_ORDER.includes(c)), // any extras not in order list
    ...(showPnl ? ['__pnl__'] : []),
  ];

  const sortedRecords = useMemo(() => {
    return records.slice().sort((a, b) => compareValues(a, b, sortKey, sortDir));
  }, [records, sortKey, sortDir]);

  useEffect(() => {
    if (hiddenCols.has(sortKey)) {
      setSortKey(DELIVERY_FIELD);
      setSortDir(-1);
    }
  }, [hiddenCols, sortKey]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(current => current * -1);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  if (!records.length) return (
    <div className="text-center py-8 text-muted-foreground text-sm">No records</div>
  );

  return (
    <div className="max-h-[520px] overflow-auto rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {displayCols.map(col => (
              <th
                 key={col}
                 onClick={() => handleSort(col)}
                 className={`sticky top-0 z-10 bg-card py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors ${
                   MONEY_COLS.has(col) ? 'text-right' : 'text-left'
                 } ${sortKey === col ? 'text-foreground' : ''}`}
               >
                 {col === '__pnl__' ? 'Gross Profit' : colLabel(col)} {sortKey === col ? (sortDir === -1 ? '↓' : '↑') : ''}
               </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRecords.map((row, i) => {
            const buyer = row[BUYER_FIELD] ?? null;
            const supplier = row[SUPPLIER_FIELD] ?? null;
            const pnl = showPnl ? getPnl(row) : null;
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
                  if (col === DELIVERY_FIELD) {
                    return (
                      <td key={col} className="py-2.5 px-3 whitespace-nowrap text-foreground">
                        <div className="flex flex-col">
                          <span>{fmtVal(col, row[col])}</span>
                          {!row[col] && row.Expected_Delivery_Date__c && (
                            <span className="text-[11px] text-amber-600">Expected: {fmtVal('Expected_Delivery_Date__c', row.Expected_Delivery_Date__c)}</span>
                          )}
                        </div>
                      </td>
                    );
                  }
                  if (col === '_Supplier_Names') {
                    const supplierNames = Array.isArray(row._Supplier_Name_List)
                      ? row._Supplier_Name_List
                      : String(row._Supplier_Names || '').split(',').map((name) => name.trim()).filter(Boolean);
                    return (
                      <td key={col} className="py-2.5 px-3 min-w-72 text-foreground">
                        {supplierNames.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {supplierNames.map((name) => (
                              <span key={name} className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] leading-5 text-foreground">
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : '—'}
                      </td>
                    );
                  }
                  if (col === '_Product_Quantities') {
                    const productQuantities = Array.isArray(row._Product_Quantity_List)
                      ? row._Product_Quantity_List
                      : String(row._Product_Quantities || '').split(',').map((value) => {
                        const label = value.trim();
                        return label ? { productName: label, quantityLabel: '' } : null;
                      }).filter(Boolean);
                    return (
                      <td key={col} className="py-2.5 px-3 min-w-96 text-foreground">
                        {productQuantities.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {productQuantities.map((item, index) => (
                              <span key={`${item.productName}-${item.quantityLabel}-${index}`} className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] leading-5 text-foreground">
                                <span className="font-medium">{item.productName}</span>
                                {item.quantityLabel && <span className="ml-1 text-muted-foreground">{item.quantityLabel}</span>}
                              </span>
                            ))}
                          </div>
                        ) : '—'}
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
