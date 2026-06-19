import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const TYPES = ['Supplier Broker', 'Buyer Broker', 'Secondary Buyer Broker'];
const HIDDEN_BROKER_FLAGS = [
  { key: 'individual', label: 'Hidden Broker Individual' },
  { key: 'company', label: 'Hidden Broker Company' },
];

export default function BrokerFilters({ search, setSearch, selectedTypes, setSelectedTypes, brokerNames, selectedBrokerNames, setSelectedBrokerNames, selectedHiddenBrokerFlags, setSelectedHiddenBrokerFlags, fromDate, setFromDate, toDate, setToDate }) {
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

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <Input placeholder="Search stem or broker…" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        {TYPES.map(type => (
          <Button key={type} type="button" size="sm" variant={selectedTypes.includes(type) ? 'default' : 'outline'} onClick={() => toggleType(type)}>
            {type}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {HIDDEN_BROKER_FLAGS.map(flag => (
          <Button key={flag.key} type="button" size="sm" variant={selectedHiddenBrokerFlags.includes(flag.key) ? 'default' : 'outline'} onClick={() => toggleHiddenBrokerFlag(flag.key)}>
            {flag.label} = true
          </Button>
        ))}
      </div>
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
          <div className="max-h-36 overflow-y-auto rounded-lg border border-border p-2 flex flex-wrap gap-2">
            {brokerNames.map(name => (
              <Button key={name} type="button" size="sm" variant={selectedBrokerNames.includes(name) ? 'default' : 'outline'} onClick={() => toggleBroker(name)}>
                {name}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
      </div>
    </div>
  );
}