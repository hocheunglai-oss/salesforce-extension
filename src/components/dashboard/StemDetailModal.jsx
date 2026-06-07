import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { Pencil, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import StemEditModal from './StemEditModal';

const SF_BASE = "https://fratellicosulich.my.salesforce.com";

const fmtDate = (v) => { try { return v ? format(new Date(v), 'dd MMM yyyy') : '—'; } catch { return v; } };
const fmtMoney = (v) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const fmtBool = (v) => v === true ? 'Yes' : v === false ? 'No' : '—';

const SECTIONS = [
  {
    title: 'Overview',
    fields: [
      { key: 'Name', label: 'Stem Name' },
      { key: 'Office__c', label: 'Office' },
      { key: 'Year__c', label: 'Year' },
      { key: 'F_STEM_Invoice__c', label: 'Invoice Type' },
      { key: 'PDD_Classification__c', label: 'PDD Classification' },
      { key: 'PO_Voyage_Number__c', label: 'PO / Voyage No.' },
      { key: 'Status__c', label: 'Status' },
      { key: 'Type__c', label: 'Type' },
    ],
  },
  {
    title: 'Vessel & Port',
    fields: [
      { key: '_Vessel_Name', label: 'Vessel' },
      { key: '_Port_Name', label: 'Port' },
      { key: '_Agent_Name', label: 'Agent' },
      { key: 'ETA_Start_Date__c', label: 'ETA Start', fmt: fmtDate },
      { key: 'ETA_End_Date__c', label: 'ETA End', fmt: fmtDate },
      { key: 'ETA_ETB__c', label: 'ETB', fmt: fmtDate },
    ],
  },
  {
    title: 'Dates',
    fields: [
      { key: 'Stem_Date__c', label: 'Stem Date', fmt: fmtDate },
      { key: 'Delivery_Date__c', label: 'Delivery Date', fmt: fmtDate },
      { key: 'Expected_Delivery_Date__c', label: 'Expected Delivery', fmt: fmtDate },
      { key: 'Due_Date__c', label: 'Due Date', fmt: fmtDate },
      { key: 'Buyer_Pay_Term_Date__c', label: 'Buyer Pay Term Date', fmt: fmtDate },
      { key: 'Payment_Date__c', label: 'Payment Date', fmt: fmtDate },
      { key: 'Original_Invoice_Sent_Date__c', label: 'Invoice Sent Date', fmt: fmtDate },
      { key: 'Original_BDN_Sent_Date__c', label: 'BDN Sent Date', fmt: fmtDate },
    ],
  },
  {
    title: 'Financials',
    fields: [
      { key: 'Total_Invoice_Amount__c', label: 'Buyer Invoice Amount', fmt: fmtMoney },
      { key: 'Total_Invoiced_Amount_From_Suppliers__c', label: 'Supplier Invoice Amount', fmt: fmtMoney },
      { key: 'Costs_Total__c', label: 'Total Costs', fmt: fmtMoney },
      { key: 'Invoice_Amount__c', label: 'Invoice Amount', fmt: fmtMoney },
      { key: 'Payment_Amount__c', label: 'Payment Amount', fmt: fmtMoney },
      { key: 'STEM_Line_Item_Total__c', label: 'Line Item Total', fmt: fmtMoney },
      { key: 'Total__c', label: 'Total', fmt: fmtMoney },
      { key: 'Balance__c', label: 'Balance', fmt: fmtMoney },
      { key: 'Actual_Balance__c', label: 'Actual Balance', fmt: fmtMoney },
      { key: 'Overdue__c', label: 'Overdue Amount', fmt: fmtMoney },
      { key: 'Buyer_Paid__c', label: 'Buyer Paid', fmt: fmtMoney },
      { key: 'Total_Difference__c', label: 'Total Difference', fmt: fmtBool },
    ],
  },
  {
    title: 'Dispute',
    fields: [
      { key: 'Dispute__c', label: 'Has Dispute', fmt: fmtBool },
      { key: 'Dispute_Status__c', label: 'Dispute Status' },
      { key: 'Dispute_Type__c', label: 'Dispute Type' },
      { key: 'Dispute_Particular__c', label: 'Dispute Particular' },
    ],
  },
  {
    title: 'Other',
    fields: [
      { key: '_Factoring_Invoice_Name', label: 'Factoring Invoice' },
      { key: 'Mailing_Status__c', label: 'Mailing Status' },
      { key: 'Due_Date_Override__c', label: 'Due Date Override', fmt: fmtBool },
      { key: 'CreatedDate', label: 'Created', fmt: fmtDate },
      { key: 'LastModifiedDate', label: 'Last Modified', fmt: fmtDate },
    ],
  },
];

function SectionHeader({ title }) {
  return (
    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 pb-1.5 border-b border-border">
      {title}
    </h3>
  );
}

function PnlBanner({ record, lineItems, buyerBrokers }) {
  const buyer = record.Total_Invoice_Amount__c;
  const supplier = record.Total_Invoiced_Amount_From_Suppliers__c;
  if (!buyer || !supplier) return null;

  // Supplier broker: per_unit × qty (negative = profit)
  const suppBrokerComm = lineItems.reduce((sum, li) => {
    return sum + ((li.Suppliers_Brokers_Commission_Per_Unit__c ?? 0) * (li.Quantity__c ?? 0));
  }, 0);
  // Buyer broker: per_unit × qty from line items + lumpsum from STEM_Buyer_Broker__c records
  const buyerBrokerCommPerUnit = lineItems.reduce((sum, li) => {
    return sum + ((li.Buyers_Brokers_Commission_Per_Unit__c ?? 0) * (li.Quantity__c ?? 0));
  }, 0);
  const buyerBrokerLumpsum = buyerBrokers.reduce((sum, bb) => sum + (bb.Commission_Lumpsum__c ?? 0), 0);
  const buyerBrokerComm = buyerBrokerCommPerUnit + buyerBrokerLumpsum;
  const grossProfit = buyer - supplier;
  const netProfit = grossProfit - suppBrokerComm - buyerBrokerComm;
  const isPositive = netProfit >= 0;

  return (
    <div className={`mt-3 rounded-xl border px-5 py-3 ${isPositive ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-0.5">Buyer Invoice</span>
          <span className="font-semibold text-foreground">{fmtMoney(buyer)}</span>
        </div>
        <div className="text-muted-foreground self-end pb-0.5">−</div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-0.5">Supplier Invoice</span>
          <span className="font-semibold text-foreground">{fmtMoney(supplier)}</span>
        </div>
        {suppBrokerComm !== 0 && (
          <>
            <div className="text-muted-foreground self-end pb-0.5">−</div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground mb-0.5">Supp Broker Comm</span>
              <span className="font-semibold text-foreground">{fmtMoney(suppBrokerComm)}</span>
            </div>
          </>
        )}
        {buyerBrokerCommPerUnit !== 0 && (
          <>
            <div className="text-muted-foreground self-end pb-0.5">−</div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground mb-0.5">Buyer Broker Comm</span>
              <span className="font-semibold text-foreground">{fmtMoney(buyerBrokerCommPerUnit)}</span>
            </div>
          </>
        )}
        {buyerBrokerLumpsum !== 0 && (
          <>
            <div className="text-muted-foreground self-end pb-0.5">−</div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground mb-0.5">Buyer Broker Lumpsum</span>
              <span className="font-semibold text-foreground">{fmtMoney(buyerBrokerLumpsum)}</span>
            </div>
          </>
        )}
        <div className="ml-auto flex flex-col items-end">
          <span className="text-xs text-muted-foreground mb-0.5">Net P&amp;L</span>
          <span className={`text-base font-bold ${isPositive ? 'text-emerald-700' : 'text-red-600'}`}>{fmtMoney(netProfit)}</span>
        </div>
      </div>
    </div>
  );
}

export default function StemDetailModal({ stemId, open, onClose, onUpdated }) {
  const [record, setRecord] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [extraCosts, setExtraCosts] = useState([]);
  const [buyerBrokers, setBuyerBrokers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!open || !stemId) return;
    setRecord(null);
    setLineItems([]);
    setExtraCosts([]);
    setBuyerBrokers([]);
    setError(null);
    setLoading(true);
    base44.functions.invoke('salesforceStemDetail', { stemId }).then(res => {
      if (res.data?.error) setError(res.data.error);
      else {
        setRecord(res.data.record);
        setLineItems(res.data.lineItems || []);
        setExtraCosts(res.data.extraCosts || []);
        setBuyerBrokers(res.data.buyerBrokers || []);
      }
      setLoading(false);
    });
  }, [open, stemId]);

  const handleSaved = (updatedRecord) => {
    setRecord(updatedRecord);
    setEditOpen(false);
    onUpdated?.();
  };

  // Build a map from line item ID → buyer broker info
  const lineItemBuyerBrokerMap = {};
  buyerBrokers.forEach(bb => {
    const liId = bb['STEM_Line_Item__r']?.Id;
    if (liId) {
      if (!lineItemBuyerBrokerMap[liId]) lineItemBuyerBrokerMap[liId] = [];
      lineItemBuyerBrokerMap[liId].push(bb);
    }
  });

  const visibleExtraCosts = extraCosts;

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-[95vw] w-[1400px] max-h-[92vh] overflow-hidden flex flex-col p-0">
          {/* Sticky Header */}
          <DialogHeader className="px-7 pt-6 pb-4 border-b border-border shrink-0 bg-card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Stem Detail</p>
                <DialogTitle className="text-xl font-bold font-dm">
                  {record?.Name || stemId}
                </DialogTitle>
                {record?._Vessel_Name && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {record._Vessel_Name}
                    {record._Port_Name && <span className="ml-2 text-muted-foreground/60">· {record._Port_Name}</span>}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {record && (
                  <a
                    href={`${SF_BASE}/${record.Id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary px-2.5 py-1.5 rounded-md border border-border hover:border-primary/40 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Salesforce
                  </a>
                )}
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={!record} className="gap-1.5">
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Button>
              </div>
            </div>

            {record && <PnlBanner record={record} lineItems={lineItems} buyerBrokers={buyerBrokers} />}

            {record?.Dispute__c && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Disputed — {record.Dispute_Type__c || ''}{record.Dispute_Status__c ? ` · ${record.Dispute_Status__c}` : ''}</span>
              </div>
            )}
          </DialogHeader>

          {/* Scrollable Body */}
          <div className="overflow-y-auto flex-1 px-7 py-6">
            {loading && (
              <div className="flex items-center justify-center py-20 text-muted-foreground gap-3">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading…
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
              </div>
            )}

            {record && !loading && (
              <div className="space-y-7">
                {/* Info sections in a 3-col grid */}
                <div className="grid grid-cols-3 gap-6">
                  {SECTIONS.map(section => {
                    const rows = section.fields.filter(f => {
                      const v = record[f.key];
                      return v != null && v !== '' && v !== false;
                    });
                    if (!rows.length) return null;
                    return (
                      <div key={section.title} className="bg-muted/20 rounded-xl p-4">
                        <SectionHeader title={section.title} />
                        <div className="space-y-2">
                          {rows.map(f => {
                            const raw = record[f.key];
                            const display = f.fmt ? f.fmt(raw) : (raw == null ? '—' : String(raw));
                            return (
                              <div key={f.key} className="flex justify-between gap-3 text-sm">
                                <span className="text-muted-foreground shrink-0">{f.label}</span>
                                <span className="text-foreground font-medium text-right">{display}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Line Items */}
                {lineItems.length > 0 && (
                  <div>
                    <SectionHeader title={`Line Items (${lineItems.length})`} />
                    <div className="rounded-xl border border-border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/40 border-b border-border">
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Product</th>
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Supplier</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Qty (MT)</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Sell/Unit</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Buy/Unit</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Total Sell</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Total Buy</th>
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Buyer Broker</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Buyer Broker/Unit</th>
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Supp Broker</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Supp Broker/Unit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lineItems.map((li, idx) => {
                            // Buyer broker: from STEM_Buyer_Broker__c linked to this line item, fallback to stem-level broker name
                            const bbs = lineItemBuyerBrokerMap[li.Id] || [];
                            const bbLumpsum = bbs.reduce((s, bb) => s + (bb.Commission_Lumpsum__c ?? 0), 0);
                            const bbName = bbs.map(bb => bb._Buyer_Broker_Name).filter(Boolean).join(', ')
                              || record._Buyer_Broker_Name || null;
                            return (
                              <tr key={li.Id} className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${idx % 2 === 0 ? '' : 'bg-muted/10'}`}>
                                <td className="py-2.5 px-3 font-medium text-foreground">{li._Product_Name || '—'}</td>
                                <td className="py-2.5 px-3 text-muted-foreground">{li.Supplier_Name__c || '—'}</td>
                                <td className="py-2.5 px-3 text-right text-foreground">
                                  {li.Is_Quantity_Range__c && li.Quantity_Max__c
                                    ? `${li.Quantity__c ?? '—'}–${li.Quantity_Max__c}`
                                    : (li.Quantity_in_MT__c > 0 ? li.Quantity_in_MT__c.toLocaleString() : (li.Quantity__c != null ? li.Quantity__c.toLocaleString() : '—'))}
                                </td>
                                <td className="py-2.5 px-3 text-right text-foreground">
                                  {li['Offer_Line_Item__r']?.UnitPrice != null ? fmtMoney(li['Offer_Line_Item__r'].UnitPrice) : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right text-foreground">
                                  {li['Offer_Line_Item__r']?.Supplier_Unit_Price__c != null ? fmtMoney(li['Offer_Line_Item__r'].Supplier_Unit_Price__c) : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right font-semibold text-foreground">{li.Total_Price__c != null ? fmtMoney(li.Total_Price__c) : '—'}</td>
                                <td className="py-2.5 px-3 text-right font-semibold text-foreground">{li.Total_Cost__c != null ? fmtMoney(li.Total_Cost__c) : '—'}</td>
                                <td className="py-2.5 px-3 text-left text-muted-foreground">{bbName || '—'}</td>
                                <td className="py-2.5 px-3 text-right text-foreground">{li.Buyers_Brokers_Commission_Per_Unit__c != null ? fmtMoney(li.Buyers_Brokers_Commission_Per_Unit__c) : '—'}</td>
                                <td className="py-2.5 px-3 text-left text-muted-foreground">{li._Supplier_Broker_Name || '—'}</td>
                                <td className="py-2.5 px-3 text-right text-foreground">{li.Suppliers_Brokers_Commission_Per_Unit__c != null ? fmtMoney(li.Suppliers_Brokers_Commission_Per_Unit__c) : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Extra Costs */}
                {extraCosts.length > 0 && (
                  <div>
                    <SectionHeader title={`Extra Costs (${extraCosts.length})`} />
                    <div className="rounded-xl border border-border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/40 border-b border-border">
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Name</th>
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Product</th>
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Supplier</th>
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Type</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Qty</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Sell/Unit</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Buy/Unit</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Lumpsum Sell</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Lumpsum Buy</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleExtraCosts.map((ec, idx) => (
                            <tr key={ec.Id} className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${idx % 2 === 0 ? '' : 'bg-muted/10'}`}>
                              <td className="py-2.5 px-3 font-medium text-foreground">{ec.Name || '—'}</td>
                              <td className="py-2.5 px-3 text-muted-foreground">{ec._Product_Name || '—'}</td>
                              <td className="py-2.5 px-3 text-muted-foreground">{ec.Supplier_Name__c || '—'}</td>
                              <td className="py-2.5 px-3 text-muted-foreground">{ec.Type__c || '—'}</td>
                              <td className="py-2.5 px-3 text-right text-foreground">{ec.Quantity__c != null ? ec.Quantity__c.toLocaleString() : '—'}</td>
                              <td className="py-2.5 px-3 text-right text-foreground">{ec.Unit_Price__c != null ? fmtMoney(ec.Unit_Price__c) : '—'}</td>
                              <td className="py-2.5 px-3 text-right text-foreground">{ec.Unit_Cost__c != null ? fmtMoney(ec.Unit_Cost__c) : '—'}</td>
                              <td className="py-2.5 px-3 text-right text-foreground">{ec.Lumpsum_Sell_At__c != null ? fmtMoney(ec.Lumpsum_Sell_At__c) : '—'}</td>
                              <td className="py-2.5 px-3 text-right text-foreground">{ec.Lumpsum_Buy_At__c != null ? fmtMoney(ec.Lumpsum_Buy_At__c) : '—'}</td>
                              <td className="py-2.5 px-3 text-right font-semibold text-foreground">{ec.Line_Total__c != null ? fmtMoney(ec.Line_Total__c) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Buyer Brokers */}
                {buyerBrokers.length > 0 && (
                  <div>
                    <SectionHeader title={`Buyer Brokers (${buyerBrokers.length})`} />
                    <div className="rounded-xl border border-border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/40 border-b border-border">
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Broker</th>
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Ref Code</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Commission</th>
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {buyerBrokers.map((bb, idx) => (
                            <tr key={bb.Id} className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${idx % 2 === 0 ? '' : 'bg-muted/10'}`}>
                              <td className="py-2.5 px-3 font-medium text-foreground">{bb._Buyer_Broker_Name || '—'}</td>
                              <td className="py-2.5 px-3 text-muted-foreground">{bb.Refcode_Index__c || '—'}</td>
                              <td className="py-2.5 px-3 text-right text-foreground">{bb.Commission_Lumpsum__c != null ? fmtMoney(bb.Commission_Lumpsum__c) : '—'}</td>
                              <td className="py-2.5 px-3">
                                {bb.Exported__c
                                  ? <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">Exported</span>
                                  : <span className="text-muted-foreground">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {record && (
        <StemEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          record={record}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}