import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import BrokerFilters from '@/components/brokers/BrokerFilters';
import BrokerRegisterTable from '@/components/brokers/BrokerRegisterTable';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import PageHeader from '@/components/common/PageHeader';
import TableShell from '@/components/common/TableShell';
import StateBlock from '@/components/common/StateBlock';

const fmtMoney = (value) => `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (value) => { try { return value ? format(new Date(value), 'dd MMM yyyy') : ''; } catch { return value || ''; } };
const fmtUnit = (value) => value != null ? `${fmtMoney(value)} / MT` : '';
const fmtDelay = (value) => value != null ? `${Number(value).toLocaleString()} day${Math.abs(Number(value)) === 1 ? '' : 's'}` : '';
const csvValue = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export default function BrokerRegister() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedBrokerNames, setSelectedBrokerNames] = useState([]);
  const [selectedHiddenBrokerFlags, setSelectedHiddenBrokerFlags] = useState([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedStemId, setSelectedStemId] = useState(null);

  const loadRows = async () => {
    setLoading(true);
    setError(null);
    const res = await appClient.functions.invoke('salesforceBrokerRegister', { limit: 2000 });
    if (res.data?.error) setError(res.data.error);
    setRows(res.data?.rows || []);
    setLoading(false);
  };

  useEffect(() => { loadRows(); }, []);

  const brokerNames = useMemo(() => {
    const visibleRows = rows.filter(row => {
      const typeMatch = !selectedTypes.length || selectedTypes.includes(row.brokerType);
      const hiddenBrokerMatch = !selectedHiddenBrokerFlags.length || selectedHiddenBrokerFlags.some(flag => flag === 'individual' ? row.hiddenBrokerIndividual : row.hiddenBrokerCompany);
      const date = row.paymentDate || '';
      const fromMatch = !fromDate || date >= fromDate;
      const toMatch = !toDate || date <= toDate;
      return typeMatch && hiddenBrokerMatch && fromMatch && toMatch;
    });
    return [...new Set(visibleRows.map(row => row.brokerName).filter(Boolean))].sort();
  }, [rows, selectedTypes, selectedHiddenBrokerFlags, fromDate, toDate]);

  const filteredRows = useMemo(() => rows.filter(row => {
    const q = search.trim().toLowerCase();
    const textMatch = !q || `${row.stemName || ''} ${row.brokerName || ''}`.toLowerCase().includes(q);
    const typeMatch = !selectedTypes.length || selectedTypes.includes(row.brokerType);
    const brokerMatch = !selectedBrokerNames.length || selectedBrokerNames.includes(row.brokerName);
    const hiddenBrokerMatch = !selectedHiddenBrokerFlags.length || selectedHiddenBrokerFlags.some(flag => flag === 'individual' ? row.hiddenBrokerIndividual : row.hiddenBrokerCompany);
    const date = row.paymentDate || '';
    const fromMatch = !fromDate || date >= fromDate;
    const toMatch = !toDate || date <= toDate;
    return textMatch && typeMatch && brokerMatch && hiddenBrokerMatch && fromMatch && toMatch;
  }), [rows, search, selectedTypes, selectedBrokerNames, selectedHiddenBrokerFlags, fromDate, toDate]);

  const total = filteredRows.reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0);

  const exportCsv = () => {
    const headers = ['Stem Name', 'Product', 'Delivery Date', 'Broker Type', 'Broker Name', 'Commission / Unit', 'Payable Balance', 'Receivable Balance', 'Payment Date Label', 'Payment Date', 'Payment Delay', 'Payment Status'];
    const csvRows = filteredRows.map(row => [
      row.stemName,
      row.productName,
      fmtDate(row.deliveryDate),
      row.brokerType,
      row.brokerName,
      fmtUnit(row.commissionUnitPrice),
      row.brokerType === 'Supplier Broker' ? fmtMoney(row.commissionAmount) : '',
      row.brokerType !== 'Supplier Broker' ? fmtMoney(row.commissionAmount) : '',
      row.paymentDateLabel,
      fmtDate(row.paymentDate),
      row.brokerType === 'Buyer Broker' || row.brokerType === 'Secondary Buyer Broker' ? fmtDelay(row.paymentDelay) : '',
      row.paymentStatus || '',
    ]);
    const csv = [headers, ...csvRows].map(row => row.map(csvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `broker-register-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        eyebrow="Salesforce broker commissions"
        title="Broker Register"
        description="Review supplier, buyer, and secondary buyer broker commissions with payment status and hidden broker flags."
        meta={`${filteredRows.length.toLocaleString()} rows · ${fmtMoney(total)} filtered commission total`}
        actions={(
          <>
          <Button variant="outline" onClick={exportCsv} disabled={loading || !filteredRows.length} className="gap-2 w-fit">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button variant="outline" onClick={loadRows} disabled={loading} className="gap-2 w-fit">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          </>
        )}
      />

      <BrokerFilters search={search} setSearch={setSearch} selectedTypes={selectedTypes} setSelectedTypes={setSelectedTypes} brokerNames={brokerNames} selectedBrokerNames={selectedBrokerNames} setSelectedBrokerNames={setSelectedBrokerNames} selectedHiddenBrokerFlags={selectedHiddenBrokerFlags} setSelectedHiddenBrokerFlags={setSelectedHiddenBrokerFlags} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="rounded-xl border border-border bg-card px-5 py-4 flex flex-wrap gap-6">
        <div><div className="text-xs text-muted-foreground uppercase tracking-wide">Rows</div><div className="text-xl font-bold">{filteredRows.length.toLocaleString()}</div></div>
        <div><div className="text-xs text-muted-foreground uppercase tracking-wide">Commission Total</div><div className="text-xl font-bold">{fmtMoney(total)}</div></div>
      </div>

      {loading && <StateBlock icon={Loader2} title="Loading broker register..." description="Fetching commissions, payment status, and broker flags from Salesforce." />}
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {!loading && !error && (
        <TableShell title="Broker Commission Rows" meta={`${filteredRows.length.toLocaleString()} matching rows`} bodyClassName="p-0">
          <BrokerRegisterTable rows={filteredRows} onRowClick={setSelectedStemId} />
        </TableShell>
      )}

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} onUpdated={loadRows} />
    </div>
  );
}
