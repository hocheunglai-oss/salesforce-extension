import { format } from 'date-fns';

const fmt = (val) => {
  if (val == null) return '—';
  return `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const fmtDate = (val) => {
  if (!val) return '—';
  try { return format(new Date(val), 'dd MMM yyyy'); } catch { return val; }
};

export default function PnlTable({ records = [] }) {
  if (!records.length) return (
    <div className="text-center py-8 text-muted-foreground text-sm">No records</div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">STEM Name</th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Stem Date</th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Office</th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Buyer Invoice</th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Supplier Invoice</th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">P&amp;L</th>
            <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Disputed</th>
          </tr>
        </thead>
        <tbody>
          {records.map((row, i) => {
            const buyer = row['Total_Invoice_Amount__c'] ?? null;
            const supplier = row['Total_Invoiced_Amount_From_Suppliers__c'] ?? null;
            const pnl = buyer != null && supplier != null ? buyer - supplier : null;
            const pnlPositive = pnl != null && pnl >= 0;

            return (
              <tr key={row.Id || i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                <td className="py-2.5 px-3 font-medium text-foreground whitespace-nowrap">{row.Name || '—'}</td>
                <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{fmtDate(row.Stem_Date__c)}</td>
                <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{row.Office__c || '—'}</td>
                <td className="py-2.5 px-3 text-right text-foreground whitespace-nowrap">{fmt(buyer)}</td>
                <td className="py-2.5 px-3 text-right text-foreground whitespace-nowrap">{fmt(supplier)}</td>
                <td className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${pnl == null ? 'text-muted-foreground' : pnlPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                  {fmt(pnl)}
                </td>
                <td className="py-2.5 px-3 text-center whitespace-nowrap">
                  {row.Dispute__c ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">Yes</span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">No</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}