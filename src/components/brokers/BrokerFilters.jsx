import { useState } from 'react';
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import BrokerDatePicker from '@/components/brokers/BrokerDatePicker';

const TYPES = ['Supplier Broker', 'Buyer Broker', 'Secondary Buyer Broker'];
const HIDDEN_BROKER_FLAGS = [
  { key: 'individual', label: 'Hidden Broker Individual' },
  { key: 'company', label: 'Hidden Broker Company' },
];
const ISO_FORMAT = 'yyyy-MM-dd';
const RANGE_OPTIONS = [
  { key: 'all', label: 'All dates' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_year', label: 'This year' },
];
const QUARTER_OPTIONS = [
  { key: 'q1', label: 'Q1', startMonth: 0, endMonth: 2 },
  { key: 'q2', label: 'Q2', startMonth: 3, endMonth: 5 },
  { key: 'q3', label: 'Q3', startMonth: 6, endMonth: 8 },
  { key: 'q4', label: 'Q4', startMonth: 9, endMonth: 11 },
];
const YEAR_OPTIONS = Array.from({ length: 8 }, (_, index) => new Date().getFullYear() - index);

export default function BrokerFilters({ search, setSearch, selectedTypes, setSelectedTypes, brokerNames, selectedBrokerNames, setSelectedBrokerNames, selectedHiddenBrokerFlags, setSelectedHiddenBrokerFlags, fromDate, setFromDate, toDate, setToDate }) {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const toggleType = (type) => {
    setSelectedTypes(selectedTypes.includes(type)
      ? selectedTypes.filter(item => item !== type)
      : [...selectedTypes, type]);
  };

  const toggleBroker = (name) => {
    setSelectedBrokerNames(selectedBrokerNames.includes(name)
      ? selectedBrokerNames.filter(item => item !== name)
      : [...selectedBrokerNames, name]);
  };

  const toggleHiddenBrokerFlag = (flag) => {
    setSelectedHiddenBrokerFlags(selectedHiddenBrokerFlags.includes(flag)
      ? selectedHiddenBrokerFlags.filter(item => item !== flag)
      : [...selectedHiddenBrokerFlags, flag]);
  };

  const applyDateRange = (rangeKey) => {
    const today = new Date();
    if (rangeKey === 'all') {
      setFromDate('');
      setToDate('');
    } else if (rangeKey === 'this_month') {
      setFromDate(format(startOfMonth(today), ISO_FORMAT));
      setToDate(format(endOfMonth(today), ISO_FORMAT));
    } else if (rangeKey === 'last_month') {
      const lastMonth = subMonths(today, 1);
      setFromDate(format(startOfMonth(lastMonth), ISO_FORMAT));
      setToDate(format(endOfMonth(lastMonth), ISO_FORMAT));
    } else if (rangeKey === 'this_year') {
      setFromDate(format(startOfYear(today), ISO_FORMAT));
      setToDate(format(endOfYear(today), ISO_FORMAT));
    }
  };

  const applyQuarterRange = (quarter) => {
    setFromDate(format(new Date(selectedYear, quarter.startMonth, 1), ISO_FORMAT));
    setToDate(format(new Date(selectedYear, quarter.endMonth + 1, 0), ISO_FORMAT));
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(360px,1.4fr)]">
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</p>
            <Input placeholder="Search stem or broker..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Broker Type</p>
            <div className="flex flex-wrap gap-2">
              {TYPES.map(type => (
                <Button key={type} type="button" size="sm" variant={selectedTypes.includes(type) ? 'default' : 'outline'} onClick={() => toggleType(type)}>
                  {type}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hidden Flags</p>
            <div className="flex flex-wrap gap-2">
              {HIDDEN_BROKER_FLAGS.map(flag => (
                <Button key={flag.key} type="button" size="sm" variant={selectedHiddenBrokerFlags.includes(flag.key) ? 'default' : 'outline'} onClick={() => toggleHiddenBrokerFlag(flag.key)}>
                  {flag.label} = true
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          {brokerNames.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Broker names</p>
                {selectedBrokerNames.length > 0 && (
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSelectedBrokerNames([])}>
                    Clear selection
                  </button>
                )}
              </div>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-background/40 p-2 flex flex-wrap gap-2">
                {brokerNames.map(name => (
                  <Button key={name} type="button" size="sm" variant={selectedBrokerNames.includes(name) ? 'default' : 'outline'} onClick={() => toggleBroker(name)}>
                    {name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date range</p>
            <div className="flex flex-wrap items-center gap-2">
              {RANGE_OPTIONS.map(option => (
                <Button key={option.key} type="button" size="sm" variant="outline" onClick={() => applyDateRange(option.key)}>
                  {option.label}
                </Button>
              ))}
              <select
                value={selectedYear}
                onChange={event => setSelectedYear(Number(event.target.value))}
                className="h-8 rounded-md border border-input bg-transparent px-3 text-xs font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {YEAR_OPTIONS.map(year => <option key={year} value={year}>{year}</option>)}
              </select>
              {QUARTER_OPTIONS.map(option => (
                <Button key={option.key} type="button" size="sm" variant="outline" onClick={() => applyQuarterRange(option)}>
                  {option.label}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <BrokerDatePicker value={fromDate} onChange={setFromDate} placeholder="dd/mm/yyyy" aria-label="From date" />
              <BrokerDatePicker value={toDate} onChange={setToDate} placeholder="dd/mm/yyyy" aria-label="To date" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
