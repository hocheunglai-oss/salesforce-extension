import { format } from 'date-fns';
import { BrokerTypeBadge, PaymentStatusBadge } from './BrokerBadges';

const fmtDate = (value) => { try { return value ? format(new Date(value), 'dd MMM yyyy') : '—'; } catch { return value || '—'; } };
const fmtMoney = (value) => `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtUnit = (value) => value != null ? `${fmtMoney(value)} / MT` : '—';
const fmtDelay = (value) => value != null ? `${Number(value).toLocaleString()} day${Math.abs(Number(value)) === 1 ? '' : 's'}` : '—';

export default function BrokerRegisterTable({ rows, onRowClick }) {
  const payableTotal = rows.reduce((sum, row) => sum + (row.brokerType === 'Supplier Broker' ? Number(row.commissionAmount || 0) : 0), 0);
  const receivableTotal = rows.reduce((sum, row) => sum + (row.brokerType !== 'Supplier Broker' ? Number(row.commissionAmount || 0) : 0), 0);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border">
              <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Stem Name</th>
              <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Product</th>
              <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Delivery Date</th>
              <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Broker Type</th>
              <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Broker Name</th>
              <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Commission / Unit</th>
              <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Payable Balance</th>
              <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Receivable Balance</th>
              <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Payment Date</th>
              <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Payment Delay</th>
              <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Payment Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id} onClick={() => onRowClick(row.stemId)} className={`border-b border-border/40 cursor-pointer hover:bg-muted/30 transition-colors ${idx % 2 ? 'bg-muted/10' : ''}`}>
                <td className="py-3 px-4 font-medium text-foreground whitespace-nowrap">{row.stemName}</td>
                <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">{row.productName || '—'}</td>
                <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">{fmtDate(row.deliveryDate)}</td>
                <td className="py-3 px-4 whitespace-nowrap"><BrokerTypeBadge type={row.brokerType} /></td>
                <td className="py-3 px-4 text-foreground">{row.brokerName || '—'}</td>
                <td className="py-3 px-4 text-right text-foreground whitespace-nowrap">{fmtUnit(row.commissionUnitPrice)}</td>
                <td className="py-3 px-4 text-right font-semibold text-foreground whitespace-nowrap">{row.brokerType === 'Supplier Broker' ? fmtMoney(row.commissionAmount) : '—'}</td>
                <td className="py-3 px-4 text-right font-semibold text-foreground whitespace-nowrap">{row.brokerType !== 'Supplier Broker' ? fmtMoney(row.commissionAmount) : '—'}</td>
                <td className="py-3 px-4 text-muted-foreground whitespace-nowrap"><span className="block text-[11px] uppercase tracking-wide">{row.paymentDateLabel}</span>{fmtDate(row.paymentDate)}</td>
                <td className="py-3 px-4 text-right text-foreground whitespace-nowrap">{row.brokerType === 'Buyer Broker' || row.brokerType === 'Secondary Buyer Broker' ? fmtDelay(row.paymentDelay) : '—'}</td>
                <td className="py-3 px-4 whitespace-nowrap"><PaymentStatusBadge status={row.paymentStatus} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="11" className="py-12 text-center text-muted-foreground">No broker commissions found.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/50 font-bold">
                <td colSpan="6" className="py-3 px-4 text-right text-foreground">Summary</td>
                <td className="py-3 px-4 text-right text-foreground whitespace-nowrap">{fmtMoney(payableTotal)}</td>
                <td className="py-3 px-4 text-right text-foreground whitespace-nowrap">{fmtMoney(receivableTotal)}</td>
                <td colSpan="3" className="py-3 px-4" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}