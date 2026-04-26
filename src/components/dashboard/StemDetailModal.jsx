import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Pencil, Loader2, AlertCircle, ExternalLink, X } from 'lucide-react';
import StemEditModal from './StemEditModal';

const SF_BASE = "https://fratellicosulich.my.salesforce.com";

const fmtDate = (v) => { try { return v ? format(new Date(v), 'dd MMM yyyy') : '—'; } catch { return v; } };
const fmtMoney = (v) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const fmtBool = (v) => v === true ? 'Yes' : v === false ? 'No' : '—';

const SECTIONS = [
  {
    title: 'Overview',
    fields: [
      { key: 'KeyStem__c', label: 'Stem Key' },
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
      { key: '_Buyer_Broker_Name', label: 'Buyer Broker' },
      { key: '_Factoring_Invoice_Name', label: 'Factoring Invoice' },
      { key: 'Mailing_Status__c', label: 'Mailing Status' },
      { key: 'Due_Date_Override__c', label: 'Due Date Override', fmt: fmtBool },
      { key: 'CreatedDate', label: 'Created', fmt: fmtDate },
      { key: 'LastModifiedDate', label: 'Last Modified', fmt: fmtDate },
    ],
  },
];

function computePnl(record, lineItems = []) {
  const buyer = record.Total_Invoice_Amount__c;
  const supplier = record.Total_Invoiced_Amount_From_Suppliers__c;
  const costs = record.Costs_Total__c ?? 0;
  
  // Sum buyer broker commissions from line items
  const buyerBrokerComm = lineItems.reduce((sum, li) => {
    const comm = li.Buyers_Brokers_Commission_Per_Unit__c;
    if (comm != null) {
      const qty = li.Quantity__c ?? 0;
      return sum + (comm * qty);
    }
    return sum;
  }, 0);

  // Sum supplier broker lumpsum commissions from line items
  const supplierBrokerLumpsum = lineItems.reduce((sum, li) => {
    return sum + (li.Suppliers_Brokers_Commission_Lumpsum__c ?? 0);
  }, 0);
  
  if (buyer == null || supplier == null) return null;
  return buyer - supplier - costs - buyerBrokerComm - supplierBrokerLumpsum;
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

  const pnl = record ? computePnl(record, lineItems) : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border sticky top-0 bg-card z-10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Stem Detail</p>
                <DialogTitle className="text-lg font-bold font-dm">
                  {record?.KeyStem__c || record?.Name || stemId}
                </DialogTitle>
                {(record?._Vessel_Name || record?.Vessel__c) && (
                  <p className="text-sm text-muted-foreground mt-0.5">Vessel: {record._Vessel_Name || record.Vessel__c}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {record && (
                  <a
                    href={`${SF_BASE}/${record.Id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Salesforce
                  </a>
                )}
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={!record} className="gap-1.5">
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Button>
              </div>
            </div>

            {/* P&L summary banner */}
            {pnl != null && (
              <div className={`mt-3 flex items-center gap-6 px-4 py-2.5 rounded-lg text-sm font-medium ${pnl >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                <span>Buyer Invoice: <strong>{fmtMoney(record.Total_Invoice_Amount__c)}</strong></span>
                <span>−</span>
                <span>Supplier Invoice: <strong>{fmtMoney(record.Total_Invoiced_Amount_From_Suppliers__c)}</strong></span>
                <span>−</span>
                <span>Costs: <strong>{fmtMoney(record.Costs_Total__c ?? 0)}</strong></span>
                <span>−</span>
                <span>Buyer Broker Comms: <strong>{fmtMoney(lineItems.reduce((sum, li) => sum + ((li.Buyers_Brokers_Commission_Per_Unit__c ?? 0) * (li.Quantity__c ?? 0)), 0))}</strong></span>
                <span>−</span>
                <span>Supp Broker Lumpsum: <strong>{fmtMoney(lineItems.reduce((sum, li) => sum + (li.Suppliers_Brokers_Commission_Lumpsum__c ?? 0), 0))}</strong></span>
                <span className="ml-auto">P&L: <strong>{fmtMoney(pnl)}</strong></span>
              </div>
            )}

            {record?.Dispute__c && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-red-50 rounded-lg text-xs text-red-600">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Disputed — {record.Dispute_Type__c || ''} {record.Dispute_Status__c ? `· ${record.Dispute_Status__c}` : ''}</span>
              </div>
            )}
          </DialogHeader>

          <div className="px-6 py-5">
            {loading && (
              <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading…
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
              </div>
            )}

            {record && !loading && (
              <div className="space-y-6">
                {SECTIONS.map(section => {
                  const rows = section.fields.filter(f => {
                    const v = record[f.key];
                    return v != null && v !== '' && v !== false;
                  });
                  if (!rows.length) return null;
                  return (
                    <div key={section.title}>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 pb-1.5 border-b border-border">
                        {section.title}
                      </h3>
                      <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
                        {rows.map(f => {
                          const raw = record[f.key];
                          const display = f.fmt ? f.fmt(raw) : (raw == null ? '—' : String(raw));
                          return (
                            <div key={f.key} className="flex justify-between gap-2 text-sm">
                              <span className="text-muted-foreground shrink-0">{f.label}</span>
                              <span className="text-foreground font-medium text-right">{display}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Suppliers Summary */}
                {lineItems.length > 0 && (() => {
                  const uniqueSuppliers = Array.from(new Set(lineItems.map(li => li.Supplier_Name__c).filter(Boolean)));
                  return uniqueSuppliers.length > 0 ? (
                    <div>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 pb-1.5 border-b border-border">
                        Suppliers ({uniqueSuppliers.length})
                      </h3>
                      <div className="space-y-2">
                        {uniqueSuppliers.map((supplier) => (
                          <div key={supplier} className="flex items-center px-3 py-2 rounded-lg bg-muted/30 text-sm">
                            <span className="font-medium text-foreground">{supplier}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* STEM Line Items */}
                {lineItems.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 pb-1.5 border-b border-border">
                      Line Items ({lineItems.length})
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Product</th>
                            <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Supplier</th>
                            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Qty</th>
                            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Sell/Unit</th>
                            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Buy/Unit</th>
                            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Total Sell</th>
                            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Total Buy</th>
                            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Buyer Broker/Unit</th>
                            <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Supplier Broker</th>
                            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Supp Broker/Unit</th>
                            <th className="text-right py-2 font-semibold text-muted-foreground">Supp Broker Lumpsum</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lineItems.map((li) => (
                            <tr key={li.Id} className="border-b border-border/40 hover:bg-muted/20">
                              <td className="py-2 pr-3 font-medium text-foreground">{li.Name__c || '—'}</td>
                              <td className="py-2 pr-3 text-muted-foreground">{li.Supplier_Name__c || '—'}</td>
                              <td className="py-2 pr-3 text-right text-foreground">
                                {li.Is_Quantity_Range__c && li.Quantity_Max__c
                                  ? `${li.Quantity__c ?? '—'}–${li.Quantity_Max__c}`
                                  : (li.Quantity_in_MT__c > 0 ? li.Quantity_in_MT__c.toLocaleString() : (li.Quantity__c != null ? li.Quantity__c.toLocaleString() : '—'))}
                              </td>
                              <td className="py-2 pr-3 text-right text-foreground">{li.Price_Per_Unit__c != null ? fmtMoney(li.Price_Per_Unit__c) : '—'}</td>
                              <td className="py-2 pr-3 text-right text-foreground">{li.Cost_Per_Unit__c != null ? fmtMoney(li.Cost_Per_Unit__c) : '—'}</td>
                              <td className="py-2 pr-3 text-right font-semibold text-foreground">{li.Total_Price__c != null ? fmtMoney(li.Total_Price__c) : '—'}</td>
                              <td className="py-2 pr-3 text-right font-semibold text-foreground">{li.Total_Cost__c != null ? fmtMoney(li.Total_Cost__c) : '—'}</td>
                              <td className="py-2 pr-3 text-right text-foreground">{li.Buyers_Brokers_Commission_Per_Unit__c != null ? fmtMoney(li.Buyers_Brokers_Commission_Per_Unit__c) : '—'}</td>
                              <td className="py-2 pr-3 text-left text-muted-foreground">{li._Supplier_Broker_Name || '—'}</td>
                              <td className="py-2 pr-3 text-right text-foreground">{li.Suppliers_Brokers_Commission_Per_Unit__c != null ? fmtMoney(li.Suppliers_Brokers_Commission_Per_Unit__c) : '—'}</td>
                              <td className="py-2 text-right text-foreground">{li.Suppliers_Brokers_Commission_Lumpsum__c != null ? fmtMoney(li.Suppliers_Brokers_Commission_Lumpsum__c) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* STEM Extra Costs */}
                {extraCosts.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 pb-1.5 border-b border-border">
                      Extra Costs ({extraCosts.length})
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Name</th>
                            <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Description</th>
                            <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Supplier</th>
                            <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Type</th>
                            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Qty</th>
                            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Sell/Unit</th>
                            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Buy/Unit</th>
                            <th className="text-right py-2 font-semibold text-muted-foreground">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {extraCosts.map((ec) => (
                            <tr key={ec.Id} className="border-b border-border/40 hover:bg-muted/20">
                              <td className="py-2 pr-3 font-medium text-foreground">{ec.Name || '—'}</td>
                              <td className="py-2 pr-3 text-muted-foreground">{ec.Description__c || '—'}</td>
                              <td className="py-2 pr-3 text-muted-foreground">{ec.Supplier_Name__c || '—'}</td>
                              <td className="py-2 pr-3 text-muted-foreground">{ec.Type__c || '—'}</td>
                              <td className="py-2 pr-3 text-right text-foreground">{ec.Quantity__c != null ? ec.Quantity__c.toLocaleString() : '—'}</td>
                              <td className="py-2 pr-3 text-right text-foreground">{ec.Unit_Price__c != null ? fmtMoney(ec.Unit_Price__c) : '—'}</td>
                              <td className="py-2 pr-3 text-right text-foreground">{ec.Unit_Cost__c != null ? fmtMoney(ec.Unit_Cost__c) : '—'}</td>
                              <td className="py-2 text-right font-semibold text-foreground">{ec.Line_Total__c != null ? fmtMoney(ec.Line_Total__c) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* STEM Buyer Brokers */}
                {buyerBrokers.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 pb-1.5 border-b border-border">
                      Buyer Brokers ({buyerBrokers.length})
                    </h3>
                    <div className="space-y-2">
                      {buyerBrokers.map((bb) => (
                        <div key={bb.Id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 text-sm">
                          <span className="font-medium text-foreground">{bb._Buyer_Broker_Name || bb.Buyer_Broker__c || '—'}</span>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            {bb.Refcode_Index__c && <span>Ref: {bb.Refcode_Index__c}</span>}
                            {bb.Exported__c && <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">Exported</span>}
                          </div>
                        </div>
                      ))}
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