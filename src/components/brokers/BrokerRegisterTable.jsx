import { format } from 'date-fns';
import { BrokerTypeBadge } from './BrokerBadges';
import { numericValue, textValue } from '@/lib/displayValue';

const fmtDate = (value) => {
  if (!value) return '—';
  if (typeof value === 'object') return textValue(value);
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return textValue(value); }
};
const fmtMoney = (value) => {
  const number = numericValue(value);
  return `$${Number(number || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtCny = (value) => {
  const number = numericValue(value);
  return `CNY ${Number(number || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtUnit = (value) => {
  if (typeof value === 'string') return value;
  const number = numericValue(value);
  return number != null ? `${fmtMoney(number)} / MT` : textValue(value);
};
const fmtDelay = (value) => {
  const number = numericValue(value);
  return number != null ? `${number.toLocaleString()} day${Math.abs(number) === 1 ? '' : 's'}` : '—';
};
const payableAmount = (row) => {
  const amount = Number(row.commissionAmount || 0);
  return amount > 0 ? amount : null;
};
const receivableAmount = (row) => {
  const amount = Number(row.commissionAmount || 0);
  return amount < 0 ? Math.abs(amount) : null;
};

function ProductQuantityCell({ row }) {
  const items = row.productQuantities?.length
    ? row.productQuantities
    : row.productQuantityLabel
      ? row.productQuantityLabel.split('; ').map((label) => ({ label }))
      : [{ label: row.productName || '—' }];

  return (
    <div className="min-w-56 space-y-1">
      {items.map((item, index) => (
        <div key={`${item.productName || item.label}-${index}`} className="text-muted-foreground">
          {item.label || `${textValue(item.productName, '')} ${item.quantity != null ? `${Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${item.quantityUnit || 'MT'}` : ''}`}
        </div>
      ))}
    </div>
  );
}

function CommissionUnitCell({ row }) {
  const items = row.commissionUnitPriceLines?.length
    ? row.commissionUnitPriceLines
    : row.commissionUnitPriceLabel
      ? row.commissionUnitPriceLabel.split('; ').map((label) => ({ label }))
      : [{ label: fmtUnit(row.commissionUnitPrice) }];

  return (
    <div className="space-y-1 text-right">
      {items.map((item, index) => (
        <div key={`${item.productName || item.label}-${index}`} className="text-foreground">
          {item.label || fmtUnit(item.value)}
        </div>
      ))}
    </div>
  );
}

export default function BrokerRegisterTable({ rows, onRowClick, exchangeRate, exchangeRateLoading, exchangeRateError }) {
  const payableTotal = rows.reduce((sum, row) => sum + Number(payableAmount(row) || 0), 0);
  const receivableTotal = rows.reduce((sum, row) => sum + Number(receivableAmount(row) || 0), 0);
  const exchangeRateValue = numericValue(exchangeRate?.rate);
  const exchangeRateLabel = exchangeRate
    ? `USD/CNY ${Number(exchangeRateValue || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} · ${fmtDate(exchangeRate.date)} · ${exchangeRate.providerLabel} · ${exchangeRate.rateType}`
    : exchangeRateError
      ? `USD/CNY conversion unavailable: ${exchangeRateError}`
      : 'USD/CNY rate loading';

  return (
    <div className="overflow-hidden">
      <div className="max-h-[620px] overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border">
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground">Stem Name</th>
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground">Products / Quantity</th>
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground">Delivery Date</th>
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground">Broker Type</th>
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground">Broker Name</th>
              <th className="sticky top-0 z-10 bg-card text-right py-3 px-4 font-semibold text-muted-foreground">Commission / Unit</th>
              <th className="sticky top-0 z-10 bg-card text-right py-3 px-4 font-semibold text-muted-foreground">Payable Balance</th>
              <th className="sticky top-0 z-10 bg-card text-right py-3 px-4 font-semibold text-muted-foreground">Receivable Balance</th>
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground">Payment Date</th>
              <th className="sticky top-0 z-10 bg-card text-right py-3 px-4 font-semibold text-muted-foreground">Payment Delay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id} onClick={() => onRowClick(row.stemId)} className={`border-b border-border/40 cursor-pointer hover:bg-muted/30 transition-colors ${idx % 2 ? 'bg-muted/10' : ''}`}>
                <td className="py-3 px-4 font-medium text-foreground whitespace-nowrap">{textValue(row.stemName)}</td>
                <td className="py-3 px-4"><ProductQuantityCell row={row} /></td>
                <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">{fmtDate(row.deliveryDate)}</td>
                <td className="py-3 px-4 whitespace-nowrap"><BrokerTypeBadge type={row.brokerType} /></td>
                <td className="py-3 px-4 text-foreground">{textValue(row.brokerName)}</td>
                <td className="py-3 px-4 whitespace-nowrap"><CommissionUnitCell row={row} /></td>
                <td className="py-3 px-4 text-right font-semibold text-foreground whitespace-nowrap">{payableAmount(row) != null ? fmtMoney(payableAmount(row)) : '—'}</td>
                <td className="py-3 px-4 text-right font-semibold text-foreground whitespace-nowrap">{receivableAmount(row) != null ? fmtMoney(receivableAmount(row)) : '—'}</td>
                <td className="py-3 px-4 text-muted-foreground whitespace-nowrap"><span className="block text-[11px] uppercase tracking-wide">{row.paymentDateLabel}</span>{fmtDate(row.paymentDate)}</td>
                <td className="py-3 px-4 text-right text-foreground whitespace-nowrap">{row.paymentDelayLabel || (row.brokerType === 'Buyer Broker' || row.brokerType === 'Secondary Buyer Broker' ? fmtDelay(row.paymentDelay) : '—')}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="10" className="py-12 text-center text-muted-foreground">No broker commissions found.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/50 font-bold">
                <td colSpan="6" className="py-3 px-4 text-right text-foreground">Summary</td>
                <td className="py-3 px-4 text-right text-foreground whitespace-nowrap">{fmtMoney(payableTotal)}</td>
                <td className="py-3 px-4 text-right text-foreground whitespace-nowrap">{fmtMoney(receivableTotal)}</td>
                <td colSpan="2" className="py-3 px-4" />
              </tr>
              <tr className="border-t border-border bg-muted/30">
                <td colSpan="6" className="py-3 px-4 text-right text-foreground">
                  <div className="font-semibold">Summary in CNY</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    {exchangeRateLoading ? 'Loading USD/CNY exchange rate...' : exchangeRateLabel}
                  </div>
                </td>
                <td className="py-3 px-4 text-right font-semibold text-foreground whitespace-nowrap">
                  {exchangeRateValue != null ? fmtCny(payableTotal * exchangeRateValue) : '—'}
                </td>
                <td className="py-3 px-4 text-right font-semibold text-foreground whitespace-nowrap">
                  {exchangeRateValue != null ? fmtCny(receivableTotal * exchangeRateValue) : '—'}
                </td>
                <td colSpan="2" className="py-3 px-4" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
