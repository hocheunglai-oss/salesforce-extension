import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { endOfQuarter, format } from 'date-fns';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import BrokerFilters from '@/components/brokers/BrokerFilters';
import BrokerRegisterTable from '@/components/brokers/BrokerRegisterTable';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import PageHeader from '@/components/common/PageHeader';
import TableShell from '@/components/common/TableShell';
import StateBlock from '@/components/common/StateBlock';
import { numericValue, textValue } from '@/lib/displayValue';

const fmtMoney = (value) => {
  const number = numericValue(value);
  return `$${Number(number || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtDate = (value) => {
  if (!value) return '';
  if (typeof value === 'object') return textValue(value, '');
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return textValue(value, ''); }
};
const fmtUnit = (value) => {
  if (typeof value === 'string') return value;
  const number = numericValue(value);
  return number != null ? `${fmtMoney(number)} / MT` : textValue(value, '');
};
const fmtDelay = (value) => {
  const number = numericValue(value);
  return number != null ? `${number.toLocaleString()} day${Math.abs(number) === 1 ? '' : 's'}` : '';
};
const csvValue = (value) => `"${textValue(value, '').replaceAll('"', '""')}"`;
const EXCHANGE_RATE_SETTINGS_KEY = 'broker_commission_exchange_rate_v1';
const ISO_FORMAT = 'yyyy-MM-dd';
const RATE_PROVIDER_OPTIONS = [
  { value: 'blended', label: 'Frankfurter blended rate' },
  { value: 'ECB', label: 'European Central Bank reference rate' },
  { value: 'HKMA', label: 'Hong Kong Monetary Authority published rate' },
  { value: 'BOC', label: 'Bank of Canada indicative rate' },
];
const payableAmount = (row) => {
  const amount = Number(row.commissionAmount || 0);
  return amount > 0 ? amount : null;
};
const receivableAmount = (row) => {
  const amount = Number(row.commissionAmount || 0);
  return amount < 0 ? Math.abs(amount) : null;
};
const readExchangeRateSettings = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(EXCHANGE_RATE_SETTINGS_KEY) || '{}');
    return { provider: saved.provider || 'blended' };
  } catch {
    return { provider: 'blended' };
  }
};
const isoDate = (date) => format(date, ISO_FORMAT);
const parseIsoDate = (value) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};
const latestRowDate = (rows) => rows
  .map((row) => row.paymentDateSort || row.paymentDate || row.deliveryDate)
  .filter(Boolean)
  .sort()
  .at(-1);
const lastWorkingDayOfQuarter = (basisDate) => {
  const parsed = parseIsoDate(basisDate) || new Date();
  const date = endOfQuarter(parsed);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() - 1);
  return isoDate(date);
};

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
  const [exchangeRateProvider, setExchangeRateProvider] = useState(() => readExchangeRateSettings().provider);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [exchangeRateLoading, setExchangeRateLoading] = useState(false);
  const [exchangeRateError, setExchangeRateError] = useState(null);

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
      const date = row.paymentDateSort || row.paymentDate || '';
      const fromMatch = !fromDate || date >= fromDate;
      const toMatch = !toDate || date <= toDate;
      return typeMatch && hiddenBrokerMatch && fromMatch && toMatch;
    });
    return [...new Set(visibleRows.map(row => textValue(row.brokerName, '')).filter(Boolean))].sort();
  }, [rows, selectedTypes, selectedHiddenBrokerFlags, fromDate, toDate]);

  const filteredRows = useMemo(() => rows.filter(row => {
    const q = search.trim().toLowerCase();
    const textMatch = !q || [row.stemName, row.brokerName, row.productQuantityLabel]
      .some(value => textValue(value, '').toLowerCase().includes(q));
    const typeMatch = !selectedTypes.length || selectedTypes.includes(row.brokerType);
    const brokerMatch = !selectedBrokerNames.length || selectedBrokerNames.includes(textValue(row.brokerName, ''));
    const hiddenBrokerMatch = !selectedHiddenBrokerFlags.length || selectedHiddenBrokerFlags.some(flag => flag === 'individual' ? row.hiddenBrokerIndividual : row.hiddenBrokerCompany);
    const date = row.paymentDateSort || row.paymentDate || '';
    const fromMatch = !fromDate || date >= fromDate;
    const toMatch = !toDate || date <= toDate;
    return textMatch && typeMatch && brokerMatch && hiddenBrokerMatch && fromMatch && toMatch;
  }), [rows, search, selectedTypes, selectedBrokerNames, selectedHiddenBrokerFlags, fromDate, toDate]);

  const total = filteredRows.reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0);
  const exchangeRateTargetDate = useMemo(() => {
    const basisDate = toDate || fromDate || latestRowDate(filteredRows) || isoDate(new Date());
    return lastWorkingDayOfQuarter(basisDate);
  }, [filteredRows, fromDate, toDate]);

  useEffect(() => {
    localStorage.setItem(EXCHANGE_RATE_SETTINGS_KEY, JSON.stringify({ provider: exchangeRateProvider }));
  }, [exchangeRateProvider]);

  useEffect(() => {
    let cancelled = false;
    const loadExchangeRate = async () => {
      setExchangeRateLoading(true);
      setExchangeRateError(null);
      const res = await appClient.functions.invoke('frankfurterUsdCnyRate', {
        date: exchangeRateTargetDate,
        provider: exchangeRateProvider,
      });
      if (cancelled) return;
      if (res.data?.error) {
        setExchangeRate(null);
        setExchangeRateError(res.data.error);
      } else {
        setExchangeRate(res.data);
      }
      setExchangeRateLoading(false);
    };
    loadExchangeRate();
    return () => { cancelled = true; };
  }, [exchangeRateProvider, exchangeRateTargetDate]);

  const exportCsv = () => {
    const headers = ['Stem Name', 'Products / Quantity', 'Delivery Date', 'Broker Type', 'Broker Name', 'Commission / Unit', 'Payable Balance', 'Receivable Balance', 'Payment Date Label', 'Payment Date', 'Payment Delay'];
    const csvRows = filteredRows.map(row => [
      row.stemName,
      row.productQuantityLabel || row.productName,
      fmtDate(row.deliveryDate),
      row.brokerType,
      row.brokerName,
      fmtUnit(row.commissionUnitPriceLabel || row.commissionUnitPrice),
      payableAmount(row) != null ? fmtMoney(payableAmount(row)) : '',
      receivableAmount(row) != null ? fmtMoney(receivableAmount(row)) : '',
      row.paymentDateLabel,
      fmtDate(row.paymentDate),
      row.paymentDelayLabel || (row.brokerType === 'Buyer Broker' || row.brokerType === 'Secondary Buyer Broker' ? fmtDelay(row.paymentDelay) : ''),
    ]);
    const csv = [headers, ...csvRows].map(row => row.map(csvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `brokers-commission-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        eyebrow="Salesforce broker commissions"
        title="Broker's Commission"
        description="Review supplier, buyer, and secondary buyer broker commissions with payment timing and hidden broker flags."
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
        <div className="min-w-72 flex-1">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">USD/CNY Exchange Rate</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select
              value={exchangeRateProvider}
              onChange={(event) => setExchangeRateProvider(event.target.value)}
              className="h-8 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {RATE_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">
              Frankfurter API · USD/CNY · no API key
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Date rule: last working day of the selected quarter.
            {exchangeRateLoading && ' Loading rate...'}
            {exchangeRateError && <span className="text-destructive"> {exchangeRateError}</span>}
            {exchangeRate && !exchangeRateLoading && (
              <span> Applied: {Number(exchangeRate.rate).toLocaleString(undefined, { maximumFractionDigits: 6 })} on {fmtDate(exchangeRate.date)} · {exchangeRate.rateType}</span>
            )}
          </div>
        </div>
      </div>

      {loading && <StateBlock icon={Loader2} title="Loading broker commissions..." description="Fetching commissions, payment timing, and broker flags from Salesforce." />}
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {!loading && !error && (
        <TableShell title="Broker Commission Rows" meta={`${filteredRows.length.toLocaleString()} matching rows`} bodyClassName="p-0">
          <BrokerRegisterTable
            rows={filteredRows}
            onRowClick={setSelectedStemId}
            exchangeRate={exchangeRate}
            exchangeRateLoading={exchangeRateLoading}
            exchangeRateError={exchangeRateError}
          />
        </TableShell>
      )}

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} onUpdated={loadRows} />
    </div>
  );
}
