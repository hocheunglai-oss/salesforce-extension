import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import BrokerFilters from '@/components/brokers/BrokerFilters';
import BrokerRegisterTable from '@/components/brokers/BrokerRegisterTable';
import StemDetailModal from '@/components/dashboard/StemDetailModal';

const fmtMoney = (value) => `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
    const res = await base44.functions.invoke('salesforceBrokerRegister', { limit: 2000 });
    if (res.data?.error) setError(res.data.error);
    setRows(res.data?.rows || []);
    setLoading(false);
  };

  useEffect(() => { loadRows(); }, []);

  const brokerNames = useMemo(() => [...new Set(rows.map(row => row.brokerName).filter(Boolean))].sort(), [rows]);

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

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Salesforce broker commissions</p>
          <h1 className="text-2xl font-bold font-dm text-foreground">Broker Register</h1>
        </div>
        <Button variant="outline" onClick={loadRows} disabled={loading} className="gap-2 w-fit">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <BrokerFilters search={search} setSearch={setSearch} selectedTypes={selectedTypes} setSelectedTypes={setSelectedTypes} brokerNames={brokerNames} selectedBrokerNames={selectedBrokerNames} setSelectedBrokerNames={setSelectedBrokerNames} selectedHiddenBrokerFlags={selectedHiddenBrokerFlags} setSelectedHiddenBrokerFlags={setSelectedHiddenBrokerFlags} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="rounded-xl border border-border bg-card px-5 py-4 flex flex-wrap gap-6">
        <div><div className="text-xs text-muted-foreground uppercase tracking-wide">Rows</div><div className="text-xl font-bold">{filteredRows.length.toLocaleString()}</div></div>
        <div><div className="text-xs text-muted-foreground uppercase tracking-wide">Commission Total</div><div className="text-xl font-bold">{fmtMoney(total)}</div></div>
      </div>

      {loading && <div className="py-16 flex items-center justify-center text-muted-foreground gap-3"><Loader2 className="w-5 h-5 animate-spin" /> Loading broker register…</div>}
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {!loading && !error && <BrokerRegisterTable rows={filteredRows} onRowClick={setSelectedStemId} />}

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} onUpdated={loadRows} />
    </div>
  );
}