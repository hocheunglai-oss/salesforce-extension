import { chunkIds, cleanRecord, sendJson, sfQuery, sfRequest } from '../_salesforce.js';

async function readBody(req) {
  if (req.method === 'GET') return {};
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  if (typeof req.json === 'function') return req.json().catch(() => ({}));

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function salesforceSchema() {
  const data = await sfRequest('/sobjects/');
  const objects = (data.sobjects || [])
    .filter((o) => o.queryable)
    .map((o) => ({ name: o.name, label: o.label, queryable: o.queryable, custom: o.custom }));
  return { objects };
}

async function salesforceObjectFields(body) {
  const { objectName } = body;
  if (!objectName) throw new Error('objectName required');
  const data = await sfRequest(`/sobjects/${encodeURIComponent(objectName)}/describe/`);
  const fields = (data.fields || []).map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    filterable: f.filterable,
    sortable: f.sortable,
    groupable: f.groupable,
    aggregatable: f.aggregatable,
    custom: f.custom,
    relationshipName: f.relationshipName || null,
    referenceTo: f.referenceTo || [],
  }));
  const childRelationships = (data.childRelationships || [])
    .filter((r) => r.relationshipName && r.childSObject)
    .map((r) => ({ relationshipName: r.relationshipName, childSObject: r.childSObject, field: r.field }));
  return { objectName, label: data.label, fields, childRelationships };
}

async function salesforceQuery(body) {
  if (!body.soql) throw new Error('soql query required');
  const result = await sfQuery(body.soql, { clean: true, limit: 2000 });
  return { records: result.records, totalSize: result.totalSize, fetched: result.records.length };
}

async function salesforceFullSchema() {
  const list = await salesforceSchema();
  const objects = await Promise.all(
    list.objects.slice(0, 2000).map(async (object) => {
      try {
        return { ...object, ...(await salesforceObjectFields({ objectName: object.name })) };
      } catch {
        return object;
      }
    })
  );
  return { objects };
}

async function salesforceDashboard() {
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);
  const hasStatus = fieldNames.includes('Status__c');
  const hasType = fieldNames.includes('Type__c');
  const hasAmount = fieldNames.includes('Amount__c');
  const profitField = ['Profit__c', 'Net_Profit__c', 'Gross_Profit__c', 'Total_Profit__c', 'ProfitAmount__c'].find((f) => fieldNames.includes(f)) || null;
  const usefulFields = ['Id', 'Name', 'CreatedDate'];
  if (hasStatus) usefulFields.push('Status__c');
  if (hasType) usefulFields.push('Type__c');
  if (hasAmount) usefulFields.push('Amount__c');
  if (fieldNames.includes('OwnerId')) usefulFields.push('OwnerId');

  const [totalRes, statusRes, typeRes, recentRes, accountRes, amountRes, profitRes] = await Promise.all([
    sfQuery('SELECT COUNT(Id) total FROM stem__c', { softFail: true }),
    hasStatus ? sfQuery('SELECT Status__c val, COUNT(Id) total FROM stem__c GROUP BY Status__c', { softFail: true }) : { records: [] },
    hasType ? sfQuery('SELECT Type__c val, COUNT(Id) total FROM stem__c GROUP BY Type__c', { softFail: true }) : { records: [] },
    sfQuery(`SELECT ${usefulFields.join(', ')} FROM stem__c ORDER BY CreatedDate DESC LIMIT 20`, { clean: true, softFail: true }),
    sfQuery('SELECT COUNT(Id) total FROM Account', { softFail: true }),
    hasAmount ? sfQuery('SELECT SUM(Amount__c) total FROM stem__c', { softFail: true }) : { records: [] },
    profitField ? sfQuery(`SELECT SUM(${profitField}) total FROM stem__c`, { softFail: true }) : { records: [] },
  ]);

  return {
    stemTotal: totalRes.records?.[0]?.total ?? totalRes.totalSize ?? 0,
    accountTotal: accountRes.records?.[0]?.total ?? 0,
    totalAmount: amountRes.records?.[0]?.total ?? null,
    totalProfit: profitRes.records?.[0]?.total ?? null,
    profitField,
    stemByStatus: (statusRes.records || []).map((r) => ({ label: r.val || 'Unknown', value: r.total })),
    stemByType: (typeRes.records || []).map((r) => ({ label: r.val || 'Unknown', value: r.total })),
    recentStems: recentRes.records || [],
    availableFields: fieldNames,
    hasStatus,
    hasType,
    hasAmount,
  };
}

async function salesforceDashboardFiltered(body) {
  const { where, trendYear } = body;
  const currentYear = Number(trendYear) || new Date().getFullYear();
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);
  const whereClause = where ? `WHERE ${where}` : '';
  const buyerField = fieldNames.includes('Buyer_Name__c') ? 'Buyer_Name__c' : fieldNames.includes('Buyer__c') ? 'Buyer__c' : null;
  const buyerAmountField = fieldNames.includes('Total_Invoice_Amount__c') ? 'Total_Invoice_Amount__c' : null;
  const supplierAmountField = fieldNames.includes('Total_Invoiced_Amount_From_Suppliers__c') ? 'Total_Invoiced_Amount_From_Suppliers__c' : null;
  const totalCostsField = fieldNames.includes('Costs_Total__c') ? 'Costs_Total__c' : null;
  const expectedDeliveryField = fieldNames.includes('Expected_Delivery_Date__c') ? 'Expected_Delivery_Date__c' : null;
  const plFields = ['Id', 'Name', 'CreatedDate'];
  if (fieldNames.includes('Delivery_Date__c')) plFields.push('Delivery_Date__c');
  if (expectedDeliveryField) plFields.push(expectedDeliveryField);
  if (fieldNames.includes('ETA_Start_Date__c')) plFields.push('ETA_Start_Date__c');
  if (buyerField) plFields.push(buyerField);
  if (buyerAmountField) plFields.push(buyerAmountField);
  if (supplierAmountField) plFields.push(supplierAmountField);
  if (totalCostsField) plFields.push(totalCostsField);
  if (fieldNames.includes('QLIK_STEM_Line_Item_Total_Cost__c')) plFields.push('QLIK_STEM_Line_Item_Total_Cost__c');
  if (fieldNames.includes('QLIK_Costs_Total_Cost__c')) plFields.push('QLIK_Costs_Total_Cost__c');
  if (fieldNames.includes('KeyStem__c')) plFields.push('KeyStem__c');

  const [totalRes, recentRes, buyerRes, supplierRes, costsRes, monthlyRes] = await Promise.all([
    sfQuery(`SELECT COUNT(Id) total FROM stem__c ${whereClause}`, { softFail: true }),
    sfQuery(`SELECT ${plFields.join(', ')} FROM stem__c ${whereClause} ORDER BY Delivery_Date__c DESC NULLS LAST, CreatedDate DESC LIMIT 3000`, { clean: true, limit: 3000, softFail: true }),
    buyerAmountField ? sfQuery(`SELECT SUM(${buyerAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
    supplierAmountField ? sfQuery(`SELECT SUM(${supplierAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
    totalCostsField ? sfQuery(`SELECT SUM(${totalCostsField}) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
    sfQuery(`SELECT Id, Delivery_Date__c${expectedDeliveryField ? `, ${expectedDeliveryField}` : ''}${buyerField ? `, ${buyerField}` : ''}${buyerAmountField ? `, ${buyerAmountField}` : ''}${supplierAmountField ? `, ${supplierAmountField}` : ''} FROM stem__c WHERE (Delivery_Date__c >= ${currentYear}-01-01 AND Delivery_Date__c <= ${currentYear}-12-31)${expectedDeliveryField ? ` OR (Delivery_Date__c = null AND ${expectedDeliveryField} >= ${currentYear}-01-01 AND ${expectedDeliveryField} <= ${currentYear}-12-31)` : ''} LIMIT 3000`, { clean: true, limit: 3000, softFail: true }),
  ]);

  const bf = buyerAmountField || 'Total_Invoice_Amount__c';
  const sf = supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c';
  const recentRows = recentRes.records || [];
  const recentStemIds = recentRows.map((stem) => stem.Id).filter(Boolean);
  const supplierLineTotalByStem = {};

  for (const chunk of chunkIds(recentStemIds)) {
    const ids = chunk.map((id) => `'${id}'`).join(',');
    const lineItems = await sfQuery(
      `SELECT STEM__c, Total_Cost__c, Cancelled__c FROM STEM_Line_Item__c WHERE STEM__c IN (${ids}) LIMIT 5000`,
      { clean: true, limit: 5000, softFail: true }
    );

    for (const item of lineItems.records || []) {
      if (!item.STEM__c || item.Cancelled__c) continue;
      supplierLineTotalByStem[item.STEM__c] = (supplierLineTotalByStem[item.STEM__c] || 0) + (item.Total_Cost__c || 0);
    }
  }

  const supplierBaseForStem = (stem) => {
    const invoiceTotal = stem[sf] ?? 0;
    return invoiceTotal || supplierLineTotalByStem[stem.Id] || null;
  };

  const recentStems = recentRows.map((stem) => ({
    ...stem,
    [sf]: supplierBaseForStem(stem),
  }));
  const totalBuyer = buyerRes.records?.[0]?.total ?? 0;
  const totalSupplier = recentStems.reduce((sum, stem) => sum + (stem[sf] || 0), 0);
  const totalCosts = costsRes.records?.[0]?.total ?? 0;
  const totalProfit = totalBuyer - totalSupplier;
  const monthlyNetPnl = Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][idx], netPnl: 0 }));
  for (const stem of monthlyRes.records || []) {
    const month = Number(String(stem.Delivery_Date__c || stem.Expected_Delivery_Date__c || '').split('-')[1]);
    if (month >= 1 && month <= 12) monthlyNetPnl[month - 1].netPnl += (stem[bf] || 0) - (stem[sf] || 0);
  }

  return {
    stemTotal: totalRes.records?.[0]?.total ?? recentStems.length,
    accountCount: null,
    totalAmount: totalBuyer,
    totalBuyer,
    totalSupplier,
    totalCosts,
    totalProfit,
    disputedCount: 0,
    totalBrokerCommissions: 0,
    stemByStatus: [],
    stemByType: [],
    recentStems,
    monthlyNetPnl,
    monthlyBuyerNetPnl: monthlyNetPnl,
    monthlyBuyerNames: [],
    topBuyersByNetPnl: [],
    availableFields: fieldNames,
    buyerAmountField,
    supplierAmountField,
    totalCostsField,
    buyerNameField: buyerField,
  };
}

async function stemPnl(body) {
  const { where, limit = 500 } = body;
  const whereClause = where ? `WHERE ${where}` : '';
  const stems = await sfQuery(`
    SELECT Id, KeyStem__c, Name, Delivery_Date__c, Account__r.Name,
           Total_Invoice_Amount__c, Total_Invoiced_Amount_From_Suppliers__c, QLIK_Total_Profit__c
    FROM stem__c
    ${whereClause}
    ORDER BY Delivery_Date__c DESC
    LIMIT ${Number(limit) || 500}
  `, { clean: true, limit: 3000 });

  const rows = stems.records.map((s) => {
    const buyer = s.Total_Invoice_Amount__c ?? 0;
    const supplier = s.Total_Invoiced_Amount_From_Suppliers__c ?? 0;
    const grossProfit = buyer - supplier;
    return {
      Id: s.Id,
      Key: s.KeyStem__c,
      Name: s.Name,
      Delivery_Date: s.Delivery_Date__c,
      Buyer: s.Account__r?.Name ?? null,
      Buyer_Invoice: buyer || null,
      Supplier_Invoice: supplier || null,
      Total_Broker_Comm: null,
      Gross_Profit: buyer && supplier ? grossProfit : null,
      Net_Profit: buyer && supplier ? grossProfit : null,
      Margin_Pct: buyer && supplier ? (grossProfit / buyer) * 100 : null,
      Qlik_Total_Profit: s.QLIK_Total_Profit__c ?? null,
    };
  });
  const complete = rows.filter((r) => r.Buyer_Invoice && r.Supplier_Invoice);
  return {
    rows,
    totals: {
      count: rows.length,
      complete: complete.length,
      Buyer_Invoice: complete.reduce((sum, r) => sum + (r.Buyer_Invoice || 0), 0),
      Supplier_Invoice: complete.reduce((sum, r) => sum + (r.Supplier_Invoice || 0), 0),
      Total_Broker_Comm: 0,
      Gross_Profit: complete.reduce((sum, r) => sum + (r.Gross_Profit || 0), 0),
      Net_Profit: complete.reduce((sum, r) => sum + (r.Net_Profit || 0), 0),
      Qlik_Net_Profit: rows.reduce((sum, r) => sum + (r.Qlik_Total_Profit || 0), 0),
    },
  };
}

async function salesforceStemDetail(body) {
  const { stemId, updates, childObject, childId, childUpdates } = body;
  if (!stemId) throw new Error('stemId required');
  let actualStemId = stemId;
  if (stemId.length < 15) {
    const lookup = await sfQuery(`SELECT Id FROM stem__c WHERE KeyStem__c = '${String(stemId).replace(/'/g, "\\'")}' LIMIT 1`, { clean: true });
    if (!lookup.records.length) throw new Error(`STEM with KeyStem__c '${stemId}' not found`);
    actualStemId = lookup.records[0].Id;
  }
  if (childObject && childId && childUpdates && Object.keys(childUpdates).length) {
    await sfRequest(`/sobjects/${childObject}/${childId}`, { method: 'PATCH', body: childUpdates });
  }
  if (updates && Object.keys(updates).length) {
    await sfRequest(`/sobjects/stem__c/${actualStemId}`, { method: 'PATCH', body: updates });
  }
  const [record, lineItems, extraCosts, buyerBrokers] = await Promise.all([
    sfRequest(`/sobjects/stem__c/${actualStemId}`).then(cleanRecord),
    sfQuery(`SELECT Id, Name, Product__c, Product__r.Name, Product__r.Family, Supplier_Name__c, BDN_Company__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Subtotal_Sell_At__c, Subtotal_Buy_At__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Payment_Term__c, BDN_Number__c, Quantity_in_MT__c, Is_Quantity_Range__c, Cancelled__c, Buyers_Brokers_Commission_Per_Unit__c, Commission_Cost__c, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Suppliers_Brokers_Commission_Lumpsum__c, Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c FROM STEM_Line_Item__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { clean: true, softFail: true }),
    sfQuery(`SELECT Id, Name, Description__c, Product2Id__c, Product2Id__r.Name, Supplier_Name__c, Quantity__c, Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Supplier_Issued__c, Payment_Term__c, Cancelled__c FROM STEM_Extra_Cost__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { clean: true, softFail: true }),
    sfQuery(`SELECT Id, Buyer_Broker__c, Refcode_Index__c, Exported__c, Commission_Lumpsum__c, STEM_Line_Item__r.Id FROM STEM_Buyer_Broker__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { clean: true, softFail: true }),
  ]);
  return { record, lineItems: lineItems.records || [], extraCosts: extraCosts.records || [], buyerBrokers: buyerBrokers.records || [] };
}

async function salesforceDescribeChildren(body) {
  const { objectType, recordId } = body;
  if (!objectType || !recordId) throw new Error('objectType and recordId required');
  const record = await sfRequest(`/sobjects/${objectType}/${recordId}`);
  return cleanRecord(record);
}

async function salesforceTopBuyers() {
  const rows = await sfQuery('SELECT Account__r.Name buyer, SUM(Total_Invoice_Amount__c) total FROM stem__c GROUP BY Account__r.Name ORDER BY SUM(Total_Invoice_Amount__c) DESC LIMIT 10', { clean: true, softFail: true });
  return { buyers: (rows.records || []).map((r) => ({ name: r.buyer || 'Unknown', total: r.total || 0 })) };
}

async function salesforceBrokerRegister(body) {
  const limit = Math.min(Number(body.limit) || 2000, 3000);
  const stems = await sfQuery(`SELECT Id, Name, Delivery_Date__c, Payment_Date__c, Buyer_Pay_Term_Date__c FROM stem__c ORDER BY Delivery_Date__c DESC NULLS LAST LIMIT ${limit}`, { clean: true, limit });
  const stemMap = Object.fromEntries(stems.records.map((stem) => [stem.Id, stem]));
  const rows = [];
  for (const chunk of chunkIds(stems.records.map((stem) => stem.Id))) {
    const ids = chunk.map((id) => `'${id}'`).join(',');
    const lineItems = await sfQuery(`SELECT Id, Name, STEM__c, Product__r.Name, Product__r.Family, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Quantity_Delivered_Per_BDN__c, Quantity__c, Quantity_in_MT__c, Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c, Buyers_Brokers_Commission_Lumpsum__c, Cancelled__c FROM STEM_Line_Item__c WHERE STEM__c IN (${ids}) LIMIT 5000`, { clean: true, softFail: true });
    for (const item of lineItems.records || []) {
      const stem = stemMap[item.STEM__c];
      if (!stem || item.Cancelled__c) continue;
      const qty = financialQuantity(item, !!stem.Delivery_Date__c);
      const supplierAmount = Number(item.Suppliers_Brokers_Commission_Per_Unit__c || 0) * Number(qty || 0);
      const buyerAmount = Number(item.Buyers_Brokers_Commission_Lumpsum__c || 0) || Number(item.Buyers_Brokers_Commission_Per_Unit__c || 0) * Number(qty || 0);
      if (item.Supplier_Broker__c && supplierAmount) rows.push({ id: `supplier-${item.Id}`, stemId: item.STEM__c, stemName: stem.Name, productName: item.Product__r?.Name || item.Name, deliveryDate: stem.Delivery_Date__c, brokerType: 'Supplier Broker', brokerName: item.Supplier_Broker__c, commissionAmount: supplierAmount });
      const buyerBrokerId = item.Buyers_Broker__c || item.Buyer_Broker__c;
      if (buyerBrokerId && buyerAmount) rows.push({ id: `buyer-${item.Id}`, stemId: item.STEM__c, stemName: stem.Name, productName: item.Product__r?.Name || item.Name, deliveryDate: stem.Delivery_Date__c, brokerType: 'Buyer Broker', brokerName: buyerBrokerId, commissionAmount: buyerAmount, paymentDate: stem.Payment_Date__c || null });
    }
  }
  return { rows };
}

async function queryRows(soql, { limit = 5000, softFail = false } = {}) {
  const result = await sfQuery(soql, { clean: true, limit, softFail });
  return result.records || [];
}

async function queryResult(soql, { limit = 5000, softFail = false } = {}) {
  return sfQuery(soql, { clean: true, limit, softFail });
}

function brokerAmount(value, qty) {
  return Number(value || 0) * Number(qty || 0);
}

function paymentDelayDays(paymentDate, dueDate) {
  if (!paymentDate || !dueDate) return null;
  const payment = new Date(paymentDate);
  const due = new Date(dueDate);
  if (Number.isNaN(payment.getTime()) || Number.isNaN(due.getTime())) return null;
  return Math.round((payment - due) / 86400000);
}

function escapeSoql(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function dateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to - from) / 86400000);
}

function earliestDate(values) {
  return values.filter(Boolean).sort()[0] || null;
}

function splitBuyerTraderNames(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const MIN_BUYER_INVOICE_DUE_DATE = '2026-01-01';
const DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS = {
  enabled: true,
  from: 'Fratelli Cosulich <info@cosulich.com.hk>',
  to: ['bt@cosulich.com.hk'],
  cc: ['lousia@cosulich.com.hk', 'laureen@cosulich.com.hk'],
  daysAhead: 7,
  subject: 'Outstanding Buyer Invoices Report',
  intro: 'Outstanding Buyer Invoices\n\nPlease find below the latest overdue buyer invoices and buyer invoices due in {{daysAhead}} days.\n\nReport window: {{reportStart}} to {{reportEnd}}. Overdue invoices are always included.',
  includeSummary: true,
  includeTable: true,
  buyerTraders: [],
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  sendTimes: ['08:00', '14:00'],
};

function normalizedUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

function buyerInvoiceAppUrl(settings = {}) {
  return normalizedUrl(settings.appUrl)
    || normalizedUrl(process.env.BUYER_INVOICE_REPORT_APP_URL)
    || normalizedUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL)
    || normalizedUrl(process.env.VERCEL_URL)
    || 'https://salesforce-extension-murex.vercel.app';
}

function buyerInvoiceFilterUrl(settings, report, buyerTrader) {
  const url = new URL('/buyer-invoices', buyerInvoiceAppUrl(settings));
  url.searchParams.set('daysAhead', String(settings.daysAhead ?? report.daysAhead ?? DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.daysAhead));
  if (buyerTrader) url.searchParams.set('buyerTrader', buyerTrader);
  return url.toString();
}

function numericValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numericValue(value);
    if (number != null) return number;
  }
  return null;
}

function litersPerMetricTon(item) {
  const family = String(item['Product__r']?.Family || item['Product2Id__r']?.Family || '').toUpperCase();
  const productName = String(item['Product__r']?.Name || item['Product2Id__r']?.Name || item.Name || item.Description__c || '').toUpperCase();
  if (family.includes('LSMGO') || family.includes('MGO') || productName.includes('LSMGO') || productName.includes('MGO') || productName.includes('DIESEL')) return 1200;
  if (family.includes('VLSFO') || productName.includes('VLSFO')) return 1030;
  if (family.includes('HSFO') || productName.includes('HSFO')) return 1030;
  return null;
}

function deliveredQuantityInMt(item) {
  const delivered = firstNumber(item.Quantity_Delivered_Per_BDN__c);
  if (delivered == null) return null;
  const litersPerMt = litersPerMetricTon(item);
  if (!litersPerMt) return delivered;
  const quantityInMt = firstNumber(item.Quantity_in_MT__c);
  const looksLikeLiters = quantityInMt != null && quantityInMt > 0
    ? delivered > quantityInMt * 20
    : delivered >= litersPerMt * 50;
  return looksLikeLiters ? delivered / litersPerMt : delivered;
}

function financialQuantity(item, stemHasDelivery, maxField = 'Quantity_Max__c') {
  if (stemHasDelivery) {
    return firstNumber(deliveredQuantityInMt(item), item.Quantity__c, item.Quantity_in_MT__c) || 0;
  }
  const min = firstNumber(item.Quantity__c, item.Quantity_in_MT__c, item.Quantity_Delivered_Per_BDN__c);
  const max = firstNumber(item[maxField]);
  if (item.Is_Quantity_Range__c && min != null && max != null) return (min + max) / 2;
  return min || 0;
}

function formatQuantityLabel(value, unit = 'MT') {
  return `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit}`;
}

function lineItemQuantityLabel(item, stemHasDelivery) {
  if (stemHasDelivery) return formatQuantityLabel(financialQuantity(item, true));
  const min = firstNumber(item.Quantity__c, item.Quantity_in_MT__c, item.Quantity_Delivered_Per_BDN__c);
  const max = firstNumber(item.Quantity_Max__c);
  if (item.Is_Quantity_Range__c && min != null && max != null) {
    return `${Number(min).toLocaleString('en-US', { maximumFractionDigits: 3 })}-${Number(max).toLocaleString('en-US', { maximumFractionDigits: 3 })} MT`;
  }
  return formatQuantityLabel(financialQuantity(item, false));
}

function lineSellAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Total_Price__c ?? 0;
  const unit = firstNumber(item.Price_Per_Unit__c, item.Unit_Sell_At__c, item['Offer_Line_Item__r']?.UnitPrice);
  const qty = financialQuantity(item, false);
  return unit != null ? unit * qty : (item.Total_Price__c ?? 0);
}

function lineBuyAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Total_Cost__c ?? 0;
  const unit = firstNumber(item.Cost_Per_Unit__c, item.Unit_Buy_At__c, item.Unit_Cost__c, item['Offer_Line_Item__r']?.Supplier_Unit_Price__c);
  const qty = financialQuantity(item, false);
  return unit != null ? unit * qty : (item.Total_Cost__c ?? 0);
}

function extraSellAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Line_Total__c ?? 0;
  const unit = firstNumber(item.Unit_Price__c);
  const qty = financialQuantity(item, false, 'Quantity_Range_Max__c');
  return unit != null ? unit * qty : (item.Line_Total__c ?? 0);
}

function extraBuyAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Line_Total_Buy__c ?? 0;
  const unit = firstNumber(item.Unit_Cost__c);
  const qty = financialQuantity(item, false, 'Quantity_Range_Max__c');
  return unit != null ? unit * qty : (item.Line_Total_Buy__c ?? 0);
}

function supplierBrokerCommission(item, stemHasDelivery) {
  return (item.Suppliers_Brokers_Commission_Per_Unit__c ?? 0) * financialQuantity(item, stemHasDelivery);
}

function buyerBrokerCommission(item, stemHasDelivery) {
  const qty = financialQuantity(item, stemHasDelivery);
  const buyerPerUnitTotal = (item.Buyers_Brokers_Commission_Per_Unit__c ?? 0) * qty;
  const suppBrokerPerUnit = item.Suppliers_Brokers_Commission_Per_Unit__c ?? 0;
  if (suppBrokerPerUnit !== 0 || item.Buyers_Brokers_Commission_Per_Unit__c != null) return buyerPerUnitTotal;
  return item.Commission_Cost__c ?? buyerPerUnitTotal;
}

function formatStemName(stem) {
  const parts = [stem.KeyStem__c, stem['Vessel__r']?.Name, stem['Port__r']?.Name].filter(Boolean);
  return parts.length ? parts.join(' - ') : stem.Name;
}

function parseEmailList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return fallback;
  const parsed = value.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function parseStringList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return fallback;
  const parsed = value.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(value) {
  if (value == null || value === '') return '-';
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function prettyDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function resolveViaQuery(objectType, id, nameField = 'Name') {
  if (!id) return null;
  try {
    const rows = await queryRows(`SELECT ${nameField} FROM ${objectType} WHERE Id = '${escapeSoql(id)}' LIMIT 1`, { softFail: true });
    return rows[0]?.[nameField] ?? null;
  } catch {
    return null;
  }
}

async function salesforceDashboardFilteredFull(body) {
  const { where, trendYear, disputeOnly, portCountry, companyKeyword, companyFilterMode } = body;
  const currentYear = Number(trendYear) || new Date().getFullYear();
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);

  const hasStatus = fieldNames.includes('Status__c');
  const hasType = fieldNames.includes('Type__c');
  const hasDispute = fieldNames.includes('Dispute__c');
  const hasDisputeStatus = fieldNames.includes('Dispute_Status__c');
  const hasDisputeType = fieldNames.includes('Dispute_Type__c');
  const hasDisputeParticular = fieldNames.includes('Dispute_Particular__c');
  const accountField = fieldNames.includes('Account__c') ? 'Account__c' : fieldNames.includes('AccountId') ? 'AccountId' : null;
  const buyerAmountField = fieldNames.includes('Total_Invoice_Amount__c') ? 'Total_Invoice_Amount__c' : null;
  const supplierAmountField = fieldNames.includes('Total_Invoiced_Amount_From_Suppliers__c') ? 'Total_Invoiced_Amount_From_Suppliers__c' : null;
  const totalCostsField = fieldNames.includes('Costs_Total__c') ? 'Costs_Total__c' : null;
  const buyerNameField = fieldNames.includes('Buyer_Name__c') ? 'Buyer_Name__c' : fieldNames.includes('Buyer__c') ? 'Buyer__c' : null;
  const expectedDeliveryField = fieldNames.includes('Expected_Delivery_Date__c') ? 'Expected_Delivery_Date__c' : null;
  const disputeCondition = disputeOnly
    ? hasDisputeStatus
      ? "Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != null"
      : hasDispute
        ? 'Dispute__c = true'
        : ''
    : '';
  const normalizedPortCountry = String(portCountry || '').trim();
  const portCountryCondition = normalizedPortCountry ? `Port__r.Country__c = '${escapeSoql(normalizedPortCountry)}'` : '';
  const normalizedCompanyKeyword = String(companyKeyword || '').trim();
  const companyMode = companyFilterMode === 'supplier' ? 'supplier' : 'buyer';
  const companyLike = normalizedCompanyKeyword ? `%${escapeSoql(normalizedCompanyKeyword)}%` : '';
  const supplierCompanyFilterActive = Boolean(normalizedCompanyKeyword && companyMode === 'supplier');
  const companyMatches = (name) => !normalizedCompanyKeyword
    || String(name || '').toLowerCase().includes(normalizedCompanyKeyword.toLowerCase());
  const companyCondition = normalizedCompanyKeyword
    ? companyMode === 'supplier'
      ? `Id IN (SELECT STEM__c FROM STEM_Line_Item__c WHERE Supplier_Name__c LIKE '${companyLike}' AND Cancelled__c = false)`
      : buyerNameField
        ? [
            `${buyerNameField} LIKE '${companyLike}'`,
            accountField ? `Account__r.Group_Name__c LIKE '${companyLike}'` : '',
            accountField ? `Account__r.Parent.Name LIKE '${companyLike}'` : '',
          ].filter(Boolean).join(' OR ')
        : ''
    : '';
  const baseWhereConditions = [where, companyCondition].filter(Boolean);
  const baseWhere = baseWhereConditions.map((condition) => `(${condition})`).join(' AND ');
  const combinedWhere = [...baseWhereConditions, disputeCondition].filter(Boolean).map((condition) => `(${condition})`).join(' AND ');
  const whereClause = combinedWhere ? `WHERE ${combinedWhere}` : '';
  const monthlyDateCondition = `(Delivery_Date__c >= ${currentYear}-01-01 AND Delivery_Date__c <= ${currentYear}-12-31)${expectedDeliveryField ? ` OR (Delivery_Date__c = null AND ${expectedDeliveryField} >= ${currentYear}-01-01 AND ${expectedDeliveryField} <= ${currentYear}-12-31)` : ''}`;
  const monthlyWhere = [monthlyDateCondition, disputeCondition, portCountryCondition, companyCondition]
    .filter(Boolean)
    .map((condition) => `(${condition})`)
    .join(' AND ');
  const monthlyWhereClause = monthlyWhere ? `WHERE ${monthlyWhere}` : '';

  const plFields = ['Id', 'Name', 'CreatedDate'];
  if (fieldNames.includes('Delivery_Date__c')) plFields.push('Delivery_Date__c');
  if (expectedDeliveryField) plFields.push(expectedDeliveryField);
  if (fieldNames.includes('ETA_Start_Date__c')) plFields.push('ETA_Start_Date__c');
  if (buyerNameField) plFields.push(buyerNameField);
  if (accountField) plFields.push('Account__r.Group_Name__c', 'Account__r.Parent.Name');
  if (hasDisputeStatus) plFields.push('Dispute_Status__c');
  if (hasDispute) plFields.push('Dispute__c');
  if (hasDisputeType) plFields.push('Dispute_Type__c');
  if (hasDisputeParticular) plFields.push('Dispute_Particular__c');
  if (buyerAmountField) plFields.push(buyerAmountField);
  if (supplierAmountField) plFields.push(supplierAmountField);
  if (totalCostsField) plFields.push(totalCostsField);
  if (fieldNames.includes('QLIK_STEM_Line_Item_Total_Cost__c')) plFields.push('QLIK_STEM_Line_Item_Total_Cost__c');
  if (fieldNames.includes('QLIK_Costs_Total_Cost__c')) plFields.push('QLIK_Costs_Total_Cost__c');
  if (fieldNames.includes('KeyStem__c')) plFields.push('KeyStem__c');

  const queries = [
    queryResult(`SELECT COUNT(Id) total FROM stem__c ${whereClause}`, { softFail: true }),
    hasStatus ? queryResult(`SELECT Status__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Status__c`, { softFail: true }) : Promise.resolve({ records: [] }),
    hasType ? queryResult(`SELECT Type__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Type__c`, { softFail: true }) : Promise.resolve({ records: [] }),
    queryResult(`SELECT ${plFields.join(', ')} FROM stem__c ${whereClause} ORDER BY Delivery_Date__c DESC NULLS LAST, CreatedDate DESC LIMIT 3000`, { limit: 3000, softFail: true }),
    hasDisputeStatus
      ? queryResult(`SELECT COUNT(Id) total FROM stem__c WHERE Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != null${baseWhere ? ` AND (${baseWhere})` : ''}`, { softFail: true })
      : hasDispute
        ? queryResult(`SELECT COUNT(Id) total FROM stem__c WHERE Dispute__c = true${baseWhere ? ` AND (${baseWhere})` : ''}`, { softFail: true })
        : Promise.resolve({ records: [] }),
    accountField ? queryResult(`SELECT ${accountField} acct, COUNT(Id) cnt FROM stem__c ${whereClause} GROUP BY ${accountField}`, { softFail: true }) : Promise.resolve({ records: [] }),
    buyerAmountField ? queryResult(`SELECT SUM(${buyerAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : Promise.resolve({ records: [] }),
    supplierAmountField ? queryResult(`SELECT SUM(${supplierAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : Promise.resolve({ records: [] }),
    totalCostsField ? queryResult(`SELECT SUM(${totalCostsField}) total FROM stem__c ${whereClause}`, { softFail: true }) : Promise.resolve({ records: [] }),
    queryResult(`SELECT Id, Delivery_Date__c, ${buyerAmountField || 'Total_Invoice_Amount__c'}, ${supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c'}, ${totalCostsField || 'Costs_Total__c'}, QLIK_STEM_Line_Item_Total_Cost__c, QLIK_Costs_Total_Cost__c FROM stem__c ${whereClause} LIMIT 3000`, { limit: 3000, softFail: true }),
    queryResult(`SELECT Id, Delivery_Date__c${expectedDeliveryField ? `, ${expectedDeliveryField}` : ''}, ${buyerNameField ? `${buyerNameField}, ` : ''}${buyerAmountField || 'Total_Invoice_Amount__c'}, ${supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c'}, QLIK_STEM_Line_Item_Total_Cost__c, QLIK_Costs_Total_Cost__c FROM stem__c ${monthlyWhereClause} LIMIT 3000`, { limit: 3000, softFail: true }),
  ];

  const results = await Promise.allSettled(queries);
  const getValue = (result) => result.status === 'fulfilled' ? result.value : { records: [], totalSize: 0 };
  const totalRes = getValue(results[0]);
  const statusRes = getValue(results[1]);
  const typeRes = getValue(results[2]);
  const recentRes = getValue(results[3]);
  const disputedRes = getValue(results[4]);
  const accountsRes = getValue(results[5]);
  const allStemsRes = getValue(results[9]);
  const monthlyStemsRes = getValue(results[10]);

  const allStemIds = [...new Set([
    ...(allStemsRes.records || []).map((s) => s.Id),
    ...(monthlyStemsRes.records || []).map((s) => s.Id),
  ])];
  const stemById = {};
  for (const stem of [...(allStemsRes.records || []), ...(monthlyStemsRes.records || [])]) stemById[stem.Id] = stem;

  let lineItems = [];
  let buyerBrokers = [];
  let extraCosts = [];
  if (allStemIds.length > 0) {
    const [lineItemChunks, buyerBrokerChunks, extraCostChunks] = await Promise.all([
      Promise.all(chunkIds(allStemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${id}'`).join(',');
        return queryRows(`SELECT STEM__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Cancelled__c, Supplier_Name__c, Buyers_Brokers_Commission_Per_Unit__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c, Product__r.Name, Product__r.Family, Price_Per_Unit__c, Cost_Per_Unit__c, Unit_Sell_At__c, Unit_Buy_At__c, Unit_Cost__c, Subtotal_Sell_At__c, Subtotal_Buy_At__c, Commission_Cost__c, Suppliers_Brokers_Commission_Per_Unit__c, Supplier_Broker__r.Name, Buyers_Broker__r.Name, Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c FROM STEM_Line_Item__c WHERE STEM__c IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
      })),
      Promise.all(chunkIds(allStemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${id}'`).join(',');
        return queryRows(`SELECT STEM__c, Commission_Lumpsum__c FROM STEM_Buyer_Broker__c WHERE STEM__c IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
      })),
      Promise.all(chunkIds(allStemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${id}'`).join(',');
        return queryRows(`SELECT STEM__c, Supplier_Name__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_in_MT__c, Quantity_Range_Max__c, Is_Quantity_Range__c, Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Cancelled__c FROM STEM_Extra_Cost__c WHERE STEM__c IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
      })),
    ]);
    lineItems = lineItemChunks.flat();
    buyerBrokers = buyerBrokerChunks.flat();
    extraCosts = extraCostChunks.flat();
  }

  const lineItemSellByStem = {};
  const extraCostSellByStem = {};
  const extraCostBuyByStem = {};
  const invoicedExtraCostBuyByStem = {};
  const sellOnlyExtraSellByStem = {};
  for (const ec of extraCosts) {
    if (!ec.STEM__c || ec.Cancelled__c) continue;
    const stemHasDelivery = !!stemById[ec.STEM__c]?.Delivery_Date__c;
    const buy = extraBuyAmount(ec, stemHasDelivery);
    const sell = extraSellAmount(ec, stemHasDelivery);
    extraCostSellByStem[ec.STEM__c] = (extraCostSellByStem[ec.STEM__c] || 0) + sell;
    if (ec.Supplier_Invoice__c) invoicedExtraCostBuyByStem[ec.STEM__c] = (invoicedExtraCostBuyByStem[ec.STEM__c] || 0) + buy;
    if (!ec.Supplier_Invoice__c) extraCostBuyByStem[ec.STEM__c] = (extraCostBuyByStem[ec.STEM__c] || 0) + buy;
    if (!ec.Supplier_Invoice__c && buy === 0 && sell > 0) sellOnlyExtraSellByStem[ec.STEM__c] = (sellOnlyExtraSellByStem[ec.STEM__c] || 0) + sell;
  }

  const supplierLineBuyByStem = {};
  const uninvoicedSupplierLineBuyByStem = {};
  const hasSupplierInvoiceByStem = {};
  const brokerByStem = {};
  const filteredStemIds = new Set((allStemsRes.records || []).map((stem) => stem.Id));
  const productFamilyQuantityByName = {};
  const supplierNamesByStem = {};
  const supplierNamesInFilteredStems = new Set();
  const supplierWeightByStem = {};
  const supplierInvoiceAmountByStem = {};
  const unassignedExtraCostBuyByStem = {};
  const productQuantitiesByStem = {};
  const addSupplierInvoiceAmount = (stemId, supplierName, amount) => {
    if (!stemId) return;
    const numericAmount = Number(amount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount === 0) return;
    const name = String(supplierName || '').trim() || 'Unspecified Supplier';
    if (!supplierInvoiceAmountByStem[stemId]) supplierInvoiceAmountByStem[stemId] = {};
    supplierInvoiceAmountByStem[stemId][name] = (supplierInvoiceAmountByStem[stemId][name] || 0) + numericAmount;
  };
  for (const li of lineItems) {
    const id = li.STEM__c;
    if (!id || li.Cancelled__c) continue;
    const stemHasDelivery = !!stemById[id]?.Delivery_Date__c;
    const lineSell = lineSellAmount(li, stemHasDelivery);
    const lineBuy = lineBuyAmount(li, stemHasDelivery);
    const productName = li['Product__r']?.Name || li.Name || 'Unspecified';
    const supplierName = String(li.Supplier_Name__c || '').trim();
    addSupplierInvoiceAmount(id, supplierName, lineBuy);
    const supplierMatchesCompanyFilter = !supplierCompanyFilterActive || companyMatches(supplierName);
    if (supplierMatchesCompanyFilter) {
      if (!productQuantitiesByStem[id]) productQuantitiesByStem[id] = [];
      productQuantitiesByStem[id].push({
        productName,
        quantityLabel: lineItemQuantityLabel(li, stemHasDelivery),
        unitOfMeasure: 'MT',
      });
    }
    if (supplierName) {
      if (!supplierNamesByStem[id]) supplierNamesByStem[id] = new Set();
      supplierNamesByStem[id].add(supplierName);
      if (supplierMatchesCompanyFilter) {
        if (filteredStemIds.has(id)) supplierNamesInFilteredStems.add(supplierName);
        if (!supplierWeightByStem[id]) supplierWeightByStem[id] = {};
        const supplierWeight = Math.abs(lineSell) || Math.abs(lineBuy) || financialQuantity(li, stemHasDelivery) || 1;
        supplierWeightByStem[id][supplierName] = (supplierWeightByStem[id][supplierName] || 0) + supplierWeight;
      }
    }
    if (filteredStemIds.has(id) && supplierMatchesCompanyFilter) {
      const family = li['Product__r']?.Family || li['Product__r']?.Name || 'Unspecified';
      productFamilyQuantityByName[family] = (productFamilyQuantityByName[family] || 0) + financialQuantity(li, stemHasDelivery);
    }
    lineItemSellByStem[id] = (lineItemSellByStem[id] || 0) + lineSell;
    supplierLineBuyByStem[id] = (supplierLineBuyByStem[id] || 0) + lineBuy;
    if (!li.Supplier_Invoice__c) {
      uninvoicedSupplierLineBuyByStem[id] = (uninvoicedSupplierLineBuyByStem[id] || 0) + lineBuy;
    }
    if (li.Supplier_Invoice__c) hasSupplierInvoiceByStem[id] = true;

    if (!brokerByStem[id]) brokerByStem[id] = { buyerComm: 0, suppCommPerUnit: 0, suppBrokerName: null, buyerBrokerName: null };
    brokerByStem[id].buyerComm += buyerBrokerCommission(li, stemHasDelivery);
    brokerByStem[id].suppCommPerUnit += supplierBrokerCommission(li, stemHasDelivery);
    if (!brokerByStem[id].suppBrokerName && li['Supplier_Broker__r']?.Name) brokerByStem[id].suppBrokerName = li['Supplier_Broker__r'].Name;
    if (!brokerByStem[id].buyerBrokerName && li['Buyers_Broker__r']?.Name) brokerByStem[id].buyerBrokerName = li['Buyers_Broker__r'].Name;
  }
  for (const ec of extraCosts) {
    if (!ec.STEM__c || ec.Cancelled__c) continue;
    const stemHasDelivery = !!stemById[ec.STEM__c]?.Delivery_Date__c;
    const buy = extraBuyAmount(ec, stemHasDelivery);
    const supplierName = String(ec.Supplier_Name__c || '').trim();
    if (supplierName) {
      addSupplierInvoiceAmount(ec.STEM__c, supplierName, buy);
      if (!supplierNamesByStem[ec.STEM__c]) supplierNamesByStem[ec.STEM__c] = new Set();
      supplierNamesByStem[ec.STEM__c].add(supplierName);
      if (filteredStemIds.has(ec.STEM__c) && (!supplierCompanyFilterActive || companyMatches(supplierName))) {
        supplierNamesInFilteredStems.add(supplierName);
      }
    } else {
      unassignedExtraCostBuyByStem[ec.STEM__c] = (unassignedExtraCostBuyByStem[ec.STEM__c] || 0) + buy;
    }
  }
  for (const bb of buyerBrokers) {
    if (!bb.STEM__c) continue;
    if (!brokerByStem[bb.STEM__c]) brokerByStem[bb.STEM__c] = { buyerComm: 0, suppCommPerUnit: 0, suppBrokerName: null, buyerBrokerName: null };
    brokerByStem[bb.STEM__c].buyerComm += bb.Commission_Lumpsum__c ?? 0;
  }

  const bf = buyerAmountField || 'Total_Invoice_Amount__c';
  const sf2 = supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c';
  const cf = totalCostsField || 'Costs_Total__c';

  const calculateStem = (stem) => {
    const calculatedBuyer = (lineItemSellByStem[stem.Id] || 0) + (extraCostSellByStem[stem.Id] || 0);
    const buyer = !stem.Delivery_Date__c && calculatedBuyer > 0 ? calculatedBuyer : stem[bf];
    const invoicedSupplier = stem[sf2] ?? 0;
    const supplierLineBuy = supplierLineBuyByStem[stem.Id] || 0;
    const uninvoicedSupplierLineBuy = uninvoicedSupplierLineBuyByStem[stem.Id] || 0;
    const supplierBase = invoicedSupplier + (hasSupplierInvoiceByStem[stem.Id] ? uninvoicedSupplierLineBuy : supplierLineBuy);
    const extraCostBuy = extraCostBuyByStem[stem.Id] || 0;
    const rawSupplier = supplierBase + extraCostBuy;
    const unmatchedSellOnlyExtra = hasSupplierInvoiceByStem[stem.Id]
      ? Math.max(0, (sellOnlyExtraSellByStem[stem.Id] || 0) - (invoicedExtraCostBuyByStem[stem.Id] || 0))
      : 0;
    const qlikSupplierCost = stem.QLIK_STEM_Line_Item_Total_Cost__c != null || stem.QLIK_Costs_Total_Cost__c != null
      ? (stem.QLIK_STEM_Line_Item_Total_Cost__c || 0) + (stem.QLIK_Costs_Total_Cost__c || 0)
      : null;
    const supplierOverstatement = qlikSupplierCost == null ? 0 : rawSupplier - qlikSupplierCost;
    const supplier = unmatchedSellOnlyExtra > 0 && supplierOverstatement > 0 && supplierOverstatement <= unmatchedSellOnlyExtra + 0.05
      ? qlikSupplierCost
      : rawSupplier;
    const buyerComm = brokerByStem[stem.Id]?.buyerComm || 0;
    const suppCommPerUnit = brokerByStem[stem.Id]?.suppCommPerUnit || 0;
    const brokerCommissions = buyerComm + suppCommPerUnit;
    return { buyer, supplier, extraCostBuy, buyerComm, suppCommPerUnit, brokerCommissions, netPnl: buyer != null ? buyer - supplier - brokerCommissions : null };
  };

  const allocateStemPnlToSuppliers = (stem, netPnl) => {
    if (netPnl == null) return [];
    const weights = supplierWeightByStem[stem.Id] || {};
    const entries = Object.entries(weights).filter(([name]) => name);
    if (!entries.length) return [];
    const totalWeight = entries.reduce((sum, [, weight]) => sum + Math.max(Number(weight) || 0, 0), 0);
    if (totalWeight <= 0) {
      const equalShare = netPnl / entries.length;
      return entries.map(([name]) => ({ name, netPnl: equalShare }));
    }
    return entries.map(([name, weight]) => ({
      name,
      netPnl: netPnl * (Math.max(Number(weight) || 0, 0) / totalWeight),
    }));
  };

  const recentStems = (recentRes.records || []).map((stem) => {
    const calc = calculateStem(stem);
    const supplierNames = [...(supplierNamesByStem[stem.Id] || [])].sort();
    const productQuantities = productQuantitiesByStem[stem.Id] || [];
    const buyerAccount = stem['Account__r'] || {};
    const buyerGroup = buyerAccount.Group_Name__c || buyerAccount.Parent?.Name || null;
    const supplierAmountMap = { ...(supplierInvoiceAmountByStem[stem.Id] || {}) };
    if (unassignedExtraCostBuyByStem[stem.Id]) {
      supplierAmountMap['Unassigned Extra Costs'] = (supplierAmountMap['Unassigned Extra Costs'] || 0) + unassignedExtraCostBuyByStem[stem.Id];
    }
    let supplierInvoiceAmountList = Object.entries(supplierAmountMap)
      .map(([supplierName, amount]) => ({ supplierName, amount: Number(amount || 0) }))
      .filter((item) => item.amount !== 0)
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName));
    const supplierListTotal = supplierInvoiceAmountList.reduce((sum, item) => sum + item.amount, 0);
    const supplierDiff = Number(calc.supplier || 0) - supplierListTotal;
    if (Math.abs(supplierDiff) > 0.05) {
      if (!supplierInvoiceAmountList.length) {
        supplierInvoiceAmountList = [{ supplierName: 'Supplier Invoice Amount', amount: Number(calc.supplier || 0) }];
      } else {
        const denominator = supplierInvoiceAmountList.reduce((sum, item) => sum + Math.abs(item.amount), 0) || supplierInvoiceAmountList.length;
        supplierInvoiceAmountList = supplierInvoiceAmountList.map((item) => {
          const ratio = denominator === supplierInvoiceAmountList.length
            ? 1 / supplierInvoiceAmountList.length
            : Math.abs(item.amount) / denominator;
          return { ...item, amount: item.amount + supplierDiff * ratio };
        });
      }
    }
    return {
      ...stem,
      [bf]: calc.buyer ?? null,
      [sf2]: calc.supplier || null,
      _Buyer_Group: buyerGroup,
      _Supplier_Name_List: supplierNames,
      _Supplier_Names: supplierNames.join(', ') || null,
      _Supplier_Invoice_Amount_List: supplierInvoiceAmountList,
      _Product_Quantity_List: productQuantities,
      _Product_Quantities: productQuantities.map((item) => `${item.productName} ${item.quantityLabel}`).join(', ') || null,
      _buyerBrokerName: brokerByStem[stem.Id]?.buyerBrokerName || null,
      _buyerBrokerComm: calc.buyerComm || null,
      _suppBrokerName: brokerByStem[stem.Id]?.suppBrokerName || null,
      _suppBrokerComm: calc.suppCommPerUnit || null,
      __buyerCommCalc: calc.buyerComm,
      __suppCommPerUnitCalc: calc.suppCommPerUnit,
      __extraCostBuyCalc: calc.extraCostBuy,
      __netPnlCalc: calc.netPnl,
    };
  });

  let totalProfit = 0;
  let totalInvoicedProfit = 0;
  let totalBuyer = 0;
  let totalSupplier = 0;
  let totalCosts = 0;
  let totalBrokerCommissions = 0;
  for (const stem of allStemsRes.records || []) {
    const calc = calculateStem(stem);
    if (calc.buyer == null) continue;
    totalProfit += calc.netPnl || 0;
    if (stem.Delivery_Date__c) totalInvoicedProfit += calc.netPnl || 0;
    totalBuyer += calc.buyer;
    totalSupplier += calc.supplier;
    totalBrokerCommissions += calc.brokerCommissions;
    totalCosts += stem[cf] ?? 0;
  }

  const buyerPnlMap = {};
  for (const stem of recentStems) {
    const buyerName = stem[buyerNameField] || null;
    if (buyerName && buyerName.toUpperCase().includes('COSULICH')) continue;
    if (!buyerName || stem[bf] == null || stem.__netPnlCalc == null) continue;
    buyerPnlMap[buyerName] = (buyerPnlMap[buyerName] || 0) + stem.__netPnlCalc;
  }
  const topBuyersByNetPnl = Object.entries(buyerPnlMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, pnl]) => ({ name, netPnl: pnl }));
  const supplierPnlMap = {};
  for (const stem of allStemsRes.records || []) {
    const calc = calculateStem(stem);
    if (calc.buyer == null || calc.netPnl == null) continue;
    for (const allocation of allocateStemPnlToSuppliers(stem, calc.netPnl)) {
      supplierPnlMap[allocation.name] = (supplierPnlMap[allocation.name] || 0) + allocation.netPnl;
    }
  }
  const topSuppliersByNetPnl = Object.entries(supplierPnlMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, pnl]) => ({ name, netPnl: pnl }));

  const monthlyTotals = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, netPnl: 0 }));
  const buyerMonthTotals = {};
  const supplierMonthTotals = {};
  for (const stem of monthlyStemsRes.records || []) {
    const effectiveDate = stem.Delivery_Date__c || stem.Expected_Delivery_Date__c;
    if (!effectiveDate) continue;
    const calc = calculateStem(stem);
    if (calc.buyer == null) continue;
    const month = Number(String(effectiveDate).split('-')[1]);
    if (!month || month < 1 || month > 12) continue;
    monthlyTotals[month - 1].netPnl += calc.netPnl || 0;
    if (buyerNameField && stem[buyerNameField] && !String(stem[buyerNameField]).toUpperCase().includes('COSULICH')) {
      const buyerName = stem[buyerNameField];
      if (!buyerMonthTotals[buyerName]) buyerMonthTotals[buyerName] = Array(12).fill(0);
      buyerMonthTotals[buyerName][month - 1] += calc.netPnl || 0;
    }
    for (const allocation of allocateStemPnlToSuppliers(stem, calc.netPnl)) {
      if (!supplierMonthTotals[allocation.name]) supplierMonthTotals[allocation.name] = Array(12).fill(0);
      supplierMonthTotals[allocation.name][month - 1] += allocation.netPnl || 0;
    }
  }
  const monthlyNetPnl = monthlyTotals.map((item) => ({
    month: item.month,
    label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][item.month - 1],
    netPnl: item.netPnl,
  }));
  const monthlyBuyerNames = Object.entries(buyerMonthTotals)
    .map(([name, months]) => ({ name, total: months.reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((item) => item.name);
  const monthlyBuyerNetPnl = monthlyNetPnl.map((item, idx) => {
    const row = { month: item.month, label: item.label };
    for (const buyerName of monthlyBuyerNames) row[buyerName] = buyerMonthTotals[buyerName]?.[idx] || 0;
    return row;
  });
  const monthlySupplierNames = Object.entries(supplierMonthTotals)
    .map(([name, months]) => ({ name, total: months.reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((item) => item.name);
  const monthlySupplierNetPnl = monthlyNetPnl.map((item, idx) => {
    const row = { month: item.month, label: item.label };
    for (const supplierName of monthlySupplierNames) row[supplierName] = supplierMonthTotals[supplierName]?.[idx] || 0;
    return row;
  });
  const productFamilyQuantities = Object.entries(productFamilyQuantityByName)
    .map(([family, quantity]) => ({ family, quantity, unitOfMeasure: 'MT' }))
    .sort((a, b) => b.quantity - a.quantity);

  return {
    stemTotal: totalRes.records?.[0]?.total ?? 0,
    accountCount: accountsRes.records ? accountsRes.records.filter((r) => r.acct != null).length : null,
    buyerAccountCount: accountsRes.records ? accountsRes.records.filter((r) => r.acct != null).length : null,
    supplierAccountCount: supplierNamesInFilteredStems.size,
    totalBuyer,
    totalSupplier,
    totalBrokerCommissions,
    totalProfit,
    totalInvoicedProfit,
    disputedCount: disputedRes.records?.[0]?.total ?? 0,
    stemByStatus: (statusRes.records || []).map((r) => ({ label: r.val || 'Unknown', value: r.total })),
    stemByType: (typeRes.records || []).map((r) => ({ label: r.val || 'Unknown', value: r.total })),
    recentStems,
    totalCosts,
    buyerAmountField,
    supplierAmountField,
    totalCostsField,
    accountField,
    topBuyersByNetPnl,
    topSuppliersByNetPnl,
    monthlyNetPnl,
    monthlyBuyerNetPnl,
    monthlyBuyerNames,
    monthlySupplierNetPnl,
    monthlySupplierNames,
    monthlyNetPnlYear: currentYear,
    productFamilyQuantities,
  };
}

async function stemPnlFull(body) {
  const { where, limit = 500 } = body;
  const whereClause = where ? `WHERE ${where}` : '';
  const stems = await queryRows(`
    SELECT Id, KeyStem__c, Name, Delivery_Date__c, Expected_Delivery_Date__c,
           Account__r.Name,
           Total_Invoice_Amount__c,
           Total_Invoiced_Amount_From_Suppliers__c,
           QLIK_STEM_Line_Item_Total_Cost__c,
           QLIK_Costs_Total_Cost__c,
           QLIK_Total_Profit__c
    FROM stem__c
    ${whereClause}
    ORDER BY Delivery_Date__c DESC NULLS LAST, CreatedDate DESC
    LIMIT ${Number(limit) || 500}
  `, { limit: Math.max(Number(limit) || 500, 500) });

  if (!stems.length) {
    return { rows: [], totals: { count: 0, complete: 0, Buyer_Invoice: 0, Supplier_Invoice: 0, Costs: 0, Total_Broker_Comm: 0, Gross_Profit: 0, Net_Profit: 0 } };
  }

  const stemIds = stems.map((s) => s.Id);
  const idChunks = chunkIds(stemIds);
  const [lineItemArrays, buyerBrokerArrays, extraCostArrays] = await Promise.all([
    Promise.all(idChunks.map((chunk) => {
      const inList = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT Id, STEM__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c,
               Product__r.Name, Product__r.Family,
               Price_Per_Unit__c, Cost_Per_Unit__c, Unit_Sell_At__c, Unit_Buy_At__c, Unit_Cost__c,
               Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Cancelled__c,
               Buyers_Brokers_Commission_Per_Unit__c,
               Buyers_Brokers_Commission_Lumpsum__c,
               Commission_Cost__c,
               Suppliers_Brokers_Commission_Per_Unit__c,
               Supplier_Broker__r.Name,
               Offer_Line_Item__r.UnitPrice,
               Offer_Line_Item__r.Supplier_Unit_Price__c
        FROM STEM_Line_Item__c
        WHERE STEM__c IN (${inList})
        LIMIT 2000
      `, { limit: 2000, softFail: true });
    })),
    Promise.all(idChunks.map(() => Promise.resolve([]))),
    Promise.all(idChunks.map((chunk) => {
      const inList = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT STEM__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_in_MT__c,
               Quantity_Range_Max__c, Is_Quantity_Range__c,
               Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c,
               Supplier_Invoice__c, Cancelled__c
        FROM STEM_Extra_Cost__c
        WHERE STEM__c IN (${inList})
        LIMIT 5000
      `, { limit: 5000, softFail: true });
    })),
  ]);

  const lineItems = lineItemArrays.flat();
  const buyerBrokerItems = buyerBrokerArrays.flat();
  const extraCosts = extraCostArrays.flat();
  const stemById = Object.fromEntries(stems.map((stem) => [stem.Id, stem]));
  const byId = {};
  const initStem = (id) => {
    if (!byId[id]) byId[id] = { suppBrokerComm: 0, buyerBrokerComm: 0, extraCostSell: 0, extraCostBuy: 0, invoicedExtraCostBuy: 0, sellOnlyExtraSell: 0, buyerLineSell: 0, supplierLineBuy: 0, uninvoicedSupplierLineBuy: 0, hasSupplierInvoice: false, suppBrokerName: null };
  };

  for (const li of lineItems) {
    const id = li.STEM__c;
    if (!id) continue;
    initStem(id);
    if (li.Cancelled__c) continue;
    const stemHasDelivery = !!stemById[id]?.Delivery_Date__c;
    const lineSell = lineSellAmount(li, stemHasDelivery);
    const lineBuy = lineBuyAmount(li, stemHasDelivery);
    byId[id].buyerLineSell += lineSell;
    byId[id].supplierLineBuy += lineBuy;
    if (!li.Supplier_Invoice__c) byId[id].uninvoicedSupplierLineBuy += lineBuy;
    if (li.Supplier_Invoice__c) byId[id].hasSupplierInvoice = true;
    byId[id].suppBrokerComm += supplierBrokerCommission(li, stemHasDelivery);
    byId[id].buyerBrokerComm += buyerBrokerCommission(li, stemHasDelivery);
    if (!byId[id].suppBrokerName && li['Supplier_Broker__r']?.Name) byId[id].suppBrokerName = li['Supplier_Broker__r'].Name;
  }
  for (const bb of buyerBrokerItems) {
    if (!bb.STEM__c) continue;
    initStem(bb.STEM__c);
    byId[bb.STEM__c].buyerBrokerComm += bb.Commission_Lumpsum__c ?? 0;
  }
  for (const ec of extraCosts) {
    if (!ec.STEM__c || ec.Cancelled__c) continue;
    initStem(ec.STEM__c);
    const stemHasDelivery = !!stemById[ec.STEM__c]?.Delivery_Date__c;
    const buy = extraBuyAmount(ec, stemHasDelivery);
    const sell = extraSellAmount(ec, stemHasDelivery);
    byId[ec.STEM__c].extraCostSell += sell;
    if (ec.Supplier_Invoice__c) byId[ec.STEM__c].invoicedExtraCostBuy += buy;
    if (!ec.Supplier_Invoice__c) byId[ec.STEM__c].extraCostBuy += buy;
    if (!ec.Supplier_Invoice__c && buy === 0 && sell > 0) byId[ec.STEM__c].sellOnlyExtraSell += sell;
  }

  const rows = stems.map((s) => {
    const agg = byId[s.Id] || {};
    const calculatedBuyer = (agg.buyerLineSell ?? 0) + (agg.extraCostSell ?? 0);
    const buyer = !s.Delivery_Date__c && calculatedBuyer > 0 ? calculatedBuyer : (s.Total_Invoice_Amount__c ?? 0);
    const supplierBase = (s.Total_Invoiced_Amount_From_Suppliers__c ?? 0) + (agg.hasSupplierInvoice ? (agg.uninvoicedSupplierLineBuy ?? 0) : (agg.supplierLineBuy ?? 0));
    const rawSupplier = supplierBase + (agg.extraCostBuy ?? 0);
    const unmatchedSellOnlyExtra = agg.hasSupplierInvoice ? Math.max(0, (agg.sellOnlyExtraSell ?? 0) - (agg.invoicedExtraCostBuy ?? 0)) : 0;
    const qlikSupplierCost = s.QLIK_STEM_Line_Item_Total_Cost__c != null || s.QLIK_Costs_Total_Cost__c != null
      ? (s.QLIK_STEM_Line_Item_Total_Cost__c || 0) + (s.QLIK_Costs_Total_Cost__c || 0)
      : null;
    const supplierOverstatement = qlikSupplierCost == null ? 0 : rawSupplier - qlikSupplierCost;
    const supplier = unmatchedSellOnlyExtra > 0 && supplierOverstatement > 0 && supplierOverstatement <= unmatchedSellOnlyExtra + 0.05
      ? qlikSupplierCost
      : rawSupplier;
    const suppBrokerComm = agg.suppBrokerComm ?? 0;
    const buyerBrokerComm = agg.buyerBrokerComm ?? 0;
    const totalBroker = suppBrokerComm + buyerBrokerComm;
    const grossProfit = buyer - supplier;
    const netProfit = grossProfit - totalBroker;
    return {
      Id: s.Id,
      Key: s.KeyStem__c,
      Name: s.Name,
      Delivery_Date: s.Delivery_Date__c,
      Expected_Delivery_Date: s.Expected_Delivery_Date__c,
      Buyer: s['Account__r']?.Name ?? null,
      Buyer_Invoice: buyer || null,
      Supplier_Invoice: supplier || null,
      Supplier_Broker_Name: agg.suppBrokerName || null,
      Supplier_Broker_Comm: suppBrokerComm !== 0 ? suppBrokerComm : null,
      Buyer_Broker_Comm: buyerBrokerComm !== 0 ? buyerBrokerComm : null,
      Total_Broker_Comm: totalBroker !== 0 ? totalBroker : null,
      Gross_Profit: buyer && supplier ? grossProfit : null,
      Net_Profit: buyer && supplier ? netProfit : null,
      Margin_Pct: buyer && supplier ? (netProfit / buyer) * 100 : null,
      Qlik_Total_Profit: s.QLIK_Total_Profit__c ?? null,
    };
  });
  const complete = rows.filter((r) => r.Buyer_Invoice && r.Supplier_Invoice);
  return {
    rows,
    totals: {
      count: rows.length,
      complete: complete.length,
      Buyer_Invoice: complete.reduce((sum, r) => sum + (r.Buyer_Invoice ?? 0), 0),
      Supplier_Invoice: complete.reduce((sum, r) => sum + (r.Supplier_Invoice ?? 0), 0),
      Total_Broker_Comm: complete.reduce((sum, r) => sum + (r.Total_Broker_Comm ?? 0), 0),
      Gross_Profit: complete.reduce((sum, r) => sum + (r.Gross_Profit ?? 0), 0),
      Net_Profit: complete.reduce((sum, r) => sum + (r.Net_Profit ?? 0), 0),
      Qlik_Net_Profit: rows.reduce((sum, r) => sum + (r.Qlik_Total_Profit ?? 0), 0),
    },
  };
}

async function salesforceBuyerInvoicesDue(body) {
  const daysAhead = Math.max(0, Math.min(Number(body.daysAhead) || 7, 365));
  const rowLimit = 10000;
  const today = dateOnly(new Date());
  const dueThrough = addDays(today, daysAhead);
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);

  const dueFields = ['Invoice_Due_Date__c', 'Buyer_Pay_Term_Date__c', 'Due_Date__c'].filter((field) => fieldNames.includes(field));
  if (!dueFields.length) return { rows: [], today, dueThrough, daysAhead };

  const fields = ['Id', 'Name'];
  for (const field of dueFields) fields.push(field);
  if (fieldNames.includes('KeyStem__c')) fields.push('KeyStem__c');
  if (fieldNames.includes('Vessel__c')) fields.push('Vessel__r.Name');
  if (fieldNames.includes('Port__c')) fields.push('Port__r.Name');
  if (fieldNames.includes('Buyer_Name__c')) fields.push('Buyer_Name__c');
  if (fieldNames.includes('Buyer__c')) fields.push('Buyer__c');
  if (fieldNames.includes('Total_Invoice_Amount__c')) fields.push('Total_Invoice_Amount__c');
  if (fieldNames.includes('Receivable_Balance__c')) fields.push('Receivable_Balance__c');
  if (fieldNames.includes('Account__c')) {
    fields.push('Account__c', 'Account__r.Name');
  }
  if (fieldNames.includes('Payment_Date__c')) fields.push('Payment_Date__c');

  const dueCondition = dueFields
    .map((field) => `(${field} != null AND ${field} >= ${MIN_BUYER_INVOICE_DUE_DATE} AND ${field} <= ${dueThrough})`)
    .join(' OR ');
  const outstandingConditions = [];
  if (fieldNames.includes('Payment_Date__c')) outstandingConditions.push('Payment_Date__c = null');
  if (fieldNames.includes('Receivable_Balance__c')) outstandingConditions.push('Receivable_Balance__c >= 50');
  const whereParts = [`(${dueCondition})`, ...outstandingConditions];

  const stems = await queryRows(`
    SELECT ${[...new Set(fields)].join(', ')}
    FROM stem__c
    WHERE ${whereParts.join(' AND ')}
    ORDER BY ${dueFields[0]} ASC NULLS LAST, Name ASC
    LIMIT ${rowLimit}
  `, { limit: rowLimit, softFail: true });

  const stemIds = stems.map((stem) => stem.Id);
  const traderByStem = {};
  if (stemIds.length) {
    const nominationArrays = await Promise.all(chunkIds(stemIds).map((chunk) => {
      const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
      return queryRows(`
        SELECT Id, Name, STEM__c, Buyer_Supplier_Trader__c
        FROM Nomination__c
        WHERE STEM__c IN (${inList}) AND Buyer_Supplier_Trader__c != null
        ORDER BY CreatedDate ASC
        LIMIT 5000
      `, { limit: 5000, softFail: true });
    }));

    for (const nomination of nominationArrays.flat()) {
      if (!nomination.STEM__c || !nomination.Buyer_Supplier_Trader__c) continue;
      if (!traderByStem[nomination.STEM__c]) traderByStem[nomination.STEM__c] = { buyer: [], all: [] };
      const name = String(nomination.Name || '');
      const value = nomination.Buyer_Supplier_Trader__c;
      if (!traderByStem[nomination.STEM__c].all.includes(value)) traderByStem[nomination.STEM__c].all.push(value);
      if (name.startsWith('Confirmation to ') && !traderByStem[nomination.STEM__c].buyer.includes(value)) {
        traderByStem[nomination.STEM__c].buyer.push(value);
      }
    }
  }

  const hasBuyerTraderFilter = Object.prototype.hasOwnProperty.call(body, 'buyerTraders');
  const selectedBuyerTradersInput = Array.isArray(body.buyerTraders)
    ? body.buyerTraders
    : splitBuyerTraderNames(body.buyerTraders);

  const allRows = stems
    .map((stem) => {
      const dueDate = earliestDate(dueFields.map((field) => stem[field]));
      if (!dueDate || dueDate > dueThrough) return null;
      if (dueDate < MIN_BUYER_INVOICE_DUE_DATE) return null;
      if (stem.KeyStem__c && stem.KeyStem__c.startsWith('T')) return null;
      if (stem.Receivable_Balance__c != null && Number(stem.Receivable_Balance__c) < 50) return null;
      const daysUntilDue = daysBetween(today, dueDate);
      const account = stem['Account__r'] || {};
      const traderInfo = traderByStem[stem.Id] || {};
      return {
        id: stem.Id,
        stemId: stem.Id,
        stemName: formatStemName(stem),
        keyStem: stem.KeyStem__c || null,
        buyerName: stem.Buyer_Name__c || account.Name || stem.Buyer__c || null,
        invoiceAmount: stem.Total_Invoice_Amount__c ?? null,
        receivableBalance: stem.Receivable_Balance__c ?? null,
        buyerInvoiceDueDate: dueDate,
        buyerTraderInCharge: (traderInfo.buyer?.length ? traderInfo.buyer : traderInfo.all || []).join(', ') || null,
        daysUntilDue,
        status: daysUntilDue == null ? 'Due' : daysUntilDue < 0 ? 'Overdue' : daysUntilDue === 0 ? 'Due Today' : 'Due Soon',
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.buyerInvoiceDueDate !== b.buyerInvoiceDueDate) return a.buyerInvoiceDueDate.localeCompare(b.buyerInvoiceDueDate);
      return String(a.stemName || '').localeCompare(String(b.stemName || ''));
    });

  const buyerTraderOptions = [...new Set(allRows.flatMap((row) => splitBuyerTraderNames(row.buyerTraderInCharge)))].sort((a, b) => a.localeCompare(b));
  const selectedBuyerTraders = selectedBuyerTradersInput
    .map((name) => String(name || '').trim())
    .filter((name) => buyerTraderOptions.includes(name));
  const activeBuyerTraders = hasBuyerTraderFilter ? selectedBuyerTraders : buyerTraderOptions;
  const activeBuyerTraderSet = new Set(activeBuyerTraders);
  const rows = hasBuyerTraderFilter && !activeBuyerTraderSet.size
    ? []
    : activeBuyerTraderSet.size && activeBuyerTraderSet.size < buyerTraderOptions.length
    ? allRows.filter((row) => splitBuyerTraderNames(row.buyerTraderInCharge).some((name) => activeBuyerTraderSet.has(name)))
    : allRows;

  return { rows, today, dueThrough, daysAhead, buyerTraderOptions, selectedBuyerTraders: activeBuyerTraders, hasBuyerTraderFilter };
}

function buyerInvoiceEmailSettings(input = {}) {
  const hasBuyerTraderFilter = Object.prototype.hasOwnProperty.call(input, 'buyerTraders');
  const defaults = {
    ...DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS,
    from: process.env.BUYER_INVOICE_REPORT_FROM || DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.from,
    to: parseEmailList(process.env.BUYER_INVOICE_REPORT_TO, DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.to),
    cc: parseEmailList(process.env.BUYER_INVOICE_REPORT_CC, DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.cc),
    appUrl: buyerInvoiceAppUrl(),
    daysAhead: Number(process.env.BUYER_INVOICE_REPORT_DAYS_AHEAD || DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.daysAhead),
    subject: process.env.BUYER_INVOICE_REPORT_SUBJECT || DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.subject,
    intro: process.env.BUYER_INVOICE_REPORT_INTRO || DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.intro,
    weekdays: parseStringList(process.env.BUYER_INVOICE_REPORT_WEEKDAYS, DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.weekdays),
    sendTimes: parseStringList(process.env.BUYER_INVOICE_REPORT_SEND_TIMES, DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.sendTimes),
  };
  return {
    ...defaults,
    ...input,
    to: parseEmailList(input.to, defaults.to),
    cc: parseEmailList(input.cc, defaults.cc),
    daysAhead: Math.max(0, Math.min(Number(input.daysAhead ?? defaults.daysAhead) || defaults.daysAhead, 365)),
    appUrl: input.appUrl || defaults.appUrl,
    includeSummary: input.includeSummary ?? defaults.includeSummary,
    includeTable: input.includeTable ?? defaults.includeTable,
    buyerTraders: parseStringList(input.buyerTraders, defaults.buyerTraders),
    hasBuyerTraderFilter,
    weekdays: parseStringList(input.weekdays, defaults.weekdays),
    sendTimes: parseStringList(input.sendTimes, defaults.sendTimes),
  };
}

function hongKongScheduleParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    weekday: value('weekday'),
    time: `${value('hour')}:${value('minute')}`,
  };
}

function isBuyerInvoiceReportDue(settings, date = new Date()) {
  const now = hongKongScheduleParts(date);
  const weekdays = new Set((settings.weekdays || []).map((day) => String(day).slice(0, 3).toLowerCase()));
  const sendTimes = new Set((settings.sendTimes || []).map((time) => String(time).trim()));
  return weekdays.has(String(now.weekday).slice(0, 3).toLowerCase()) && sendTimes.has(now.time);
}

function overdueSeverity(daysUntilDue) {
  if (daysUntilDue == null || Number(daysUntilDue) > 0) return null;
  const overdueDays = Math.abs(Number(daysUntilDue));
  if (overdueDays >= 14) return 'red';
  if (overdueDays >= 7) return 'orange';
  return 'yellow';
}

function overdueDisplayValue(daysUntilDue) {
  if (daysUntilDue == null) return '-';
  return String(-Number(daysUntilDue));
}

function overdueEmailStyles(daysUntilDue) {
  const severity = overdueSeverity(daysUntilDue);
  const styles = {
    red: { row: 'background:#fee2e2', border: '#fca5a5', text: '#991b1b', pill: 'background:#fecaca;border-color:#f87171;color:#7f1d1d' },
    orange: { row: 'background:#fed7aa', border: '#fb923c', text: '#9a3412', pill: 'background:#fdba74;border-color:#f97316;color:#7c2d12' },
    yellow: { row: 'background:#fde68a', border: '#facc15', text: '#854d0e', pill: 'background:#fcd34d;border-color:#eab308;color:#713f12' },
  };
  return styles[severity] || { row: '', border: '#e5e7eb', text: '#2563eb', pill: 'background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8' };
}

function renderBuyerInvoiceEmailContent(template, report, settings) {
  return String(template || DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.intro)
    .replaceAll('{{reportStart}}', prettyDate(report.today))
    .replaceAll('{{reportEnd}}', prettyDate(report.dueThrough))
    .replaceAll('{{daysAhead}}', String(settings.daysAhead ?? report.daysAhead ?? DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.daysAhead));
}

function emailContentHtml(content) {
  const blocks = String(content || '').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) return '';
  return blocks.map((block, index) => {
    const html = escapeHtml(block).replaceAll('\n', '<br>');
    if (index === 0) return `<h2 style="margin:0 0 6px;font-size:20px">${html}</h2>`;
    return `<p style="margin:0 0 14px;color:#667085">${html}</p>`;
  }).join('');
}

function buyerTraderFilterHtml(report, settings) {
  const options = report.buyerTraderOptions || [];
  if (!options.length) return '';
  const selected = new Set(report.hasBuyerTraderFilter ? (report.selectedBuyerTraders || []) : options);
  const allActive = selected.size === options.length;
  const allUrl = buyerInvoiceFilterUrl(settings, report, null);
  const allChip = `<a href="${escapeHtml(allUrl)}" style="display:inline-block;text-decoration:none;border:1px solid ${allActive ? '#2563eb' : '#d9e2ef'};border-radius:6px;padding:4px 10px;margin:0 6px 6px 0;font-size:12px;font-weight:600;${allActive ? 'background:#2563eb;color:#fff' : 'background:#f8fafc;color:#2563eb'}">All</a>`;
  const chips = options.map((name) => {
    const active = selected.has(name);
    const url = buyerInvoiceFilterUrl(settings, report, name);
    return `<a href="${escapeHtml(url)}" style="display:inline-block;text-decoration:none;border:1px solid ${active ? '#2563eb' : '#d9e2ef'};border-radius:6px;padding:4px 10px;margin:0 6px 6px 0;font-size:12px;font-weight:600;${active ? 'background:#2563eb;color:#fff' : 'background:#f8fafc;color:#2563eb'}">${escapeHtml(name)}</a>`;
  }).join('');
  return `
    <div style="margin:0 0 12px">
      <div style="font-size:11px;color:#667085;text-transform:uppercase;letter-spacing:.04em;font-weight:700;margin-bottom:6px">Open filtered view by Buyer Trader in Charge</div>
      <div>${allChip}${chips}</div>
    </div>`;
}

function buildBuyerInvoiceReportEmail(report, settings) {
  const rows = report.rows || [];
  const overdue = rows.filter((row) => row.status === 'Overdue');
  const dueSoon = rows.filter((row) => row.status !== 'Overdue');
  const dueSoonLabel = `Due in ${Number(settings.daysAhead || report.daysAhead || 7).toLocaleString()} Days`;
  const content = renderBuyerInvoiceEmailContent(settings.intro, report, settings);
  const totals = {
    overdueCount: overdue.length,
    overdueReceivable: overdue.reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0),
    dueSoonCount: dueSoon.length,
    dueSoonReceivable: dueSoon.reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0),
  };
  const subject = `${settings.subject} - ${prettyDate(report.today)}`;
  const summaryHtml = settings.includeSummary ? `
    <table role="presentation" style="border-collapse:collapse;margin:18px 0;width:100%;max-width:620px">
      <tr>
        <td style="border:1px solid #d9e2ef;border-radius:8px 0 0 8px;padding:12px;background:#fff7f7">
          <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em">Overdue</div>
          <div style="font-size:20px;font-weight:700;color:#dc2626">${money(totals.overdueReceivable)} (${totals.overdueCount})</div>
        </td>
        <td style="border:1px solid #d9e2ef;border-left:0;border-radius:0 8px 8px 0;padding:12px;background:#f7fbff">
          <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(dueSoonLabel)}</div>
          <div style="font-size:20px;font-weight:700;color:#2563eb">${money(totals.dueSoonReceivable)} (${totals.dueSoonCount})</div>
        </td>
      </tr>
    </table>` : '';
  const tableRows = rows.map((row) => {
    const severity = overdueEmailStyles(row.daysUntilDue);
    const cellStyle = `border-bottom:1px solid ${severity.border};padding:8px 10px`;
    return `
    <tr style="${severity.row}">
      <td style="${cellStyle};font-weight:600;white-space:nowrap">${escapeHtml(row.stemName)}</td>
      <td style="${cellStyle};min-width:180px">${escapeHtml(row.buyerName || '-')}</td>
      <td style="${cellStyle};text-align:right;white-space:nowrap">${money(row.invoiceAmount)}</td>
      <td style="${cellStyle};text-align:right;font-weight:600;white-space:nowrap">${money(row.receivableBalance)}</td>
      <td style="${cellStyle};white-space:nowrap">${prettyDate(row.buyerInvoiceDueDate)}</td>
      <td style="${cellStyle};min-width:140px">${escapeHtml(row.buyerTraderInCharge || '-')}</td>
      <td style="${cellStyle}">
        <span style="display:inline-block;border:1px solid;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:600;white-space:nowrap;${severity.pill}">${escapeHtml(row.status)}</span>
      </td>
      <td style="${cellStyle};text-align:right;font-weight:600;color:${severity.text};white-space:nowrap">${overdueDisplayValue(row.daysUntilDue)}</td>
    </tr>`;
  }).join('');
  const tableHtml = settings.includeTable ? `
    ${buyerTraderFilterHtml(report, settings)}
    <div style="max-height:420px;overflow:auto;border:1px solid #d9e2ef;border-radius:10px">
      <table style="border-collapse:collapse;width:100%;min-width:980px;font-size:13px">
        <thead>
          <tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px;letter-spacing:.04em">
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Stem Name</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Buyer Name</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:right;position:sticky;top:0;background:#f8fafc">Invoice Amount</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:right;position:sticky;top:0;background:#f8fafc">Receivable Balance</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Due Date</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Buyer Trader</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Status</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:right;position:sticky;top:0;background:#f8fafc">Overdue</th>
          </tr>
        </thead>
        <tbody>${tableRows || '<tr><td colspan="8" style="padding:18px;text-align:center;color:#667085">No outstanding buyer invoices found.</td></tr>'}</tbody>
      </table>
    </div>` : '';
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1f2937;line-height:1.45">
      ${emailContentHtml(content)}
      ${summaryHtml}
      ${tableHtml}
    </div>`;
  const textLines = [
    content,
    `Overdue: ${money(totals.overdueReceivable)} (${totals.overdueCount})`,
    `${dueSoonLabel}: ${money(totals.dueSoonReceivable)} (${totals.dueSoonCount})`,
    `Open all invoices: ${buyerInvoiceFilterUrl(settings, report, null)}`,
    ...((report.buyerTraderOptions || []).map((name) => `Open ${name}: ${buyerInvoiceFilterUrl(settings, report, name)}`)),
    '',
    ...rows.map((row) => `${row.stemName} | ${row.buyerName || '-'} | Receivable Balance ${money(row.receivableBalance)} | Due ${prettyDate(row.buyerInvoiceDueDate)} | ${row.status} | Overdue ${overdueDisplayValue(row.daysUntilDue)} | Buyer Trader ${row.buyerTraderInCharge || '-'}`),
  ];
  return { subject, html, text: textLines.join('\n'), totals };
}

async function sendWithResend({ from, to, cc, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Missing RESEND_API_KEY in Vercel. Add it for scheduled email reports, or enable a saved SMTP account in Settings for Send Now.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from, to, cc, subject, html, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Resend request failed: ${res.status}`);
  return data;
}

async function sendWithSmtp({ smtp = {}, from, to, cc, subject, html, text }) {
  const host = smtp.host || process.env.SMTP_HOST;
  const port = Number(smtp.port || process.env.SMTP_PORT || 587);
  const user = smtp.user || process.env.SMTP_USER;
  const pass = smtp.password || smtp.pass || process.env.SMTP_PASSWORD;
  const secure = smtp.secure != null
    ? smtp.secure === true || smtp.secure === 'true'
    : process.env.SMTP_SECURE != null
      ? process.env.SMTP_SECURE === 'true'
      : port === 465;
  if (!host || !user || !pass) {
    throw new Error('Missing SMTP credentials. Enter SMTP host, username, and password, or configure SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in Vercel.');
  }
  const nodemailer = await import('nodemailer');
  const createTransport = nodemailer.createTransport || nodemailer.default?.createTransport;
  if (!createTransport) throw new Error('SMTP email library failed to load.');
  const transporter = createTransport({
    host,
    port,
    secure: Boolean(secure),
    auth: { user, pass },
  });
  const result = await transporter.sendMail({ from, to, cc, subject, html, text });
  return { id: result.messageId, accepted: result.accepted, rejected: result.rejected };
}

async function outstandingBuyerInvoicesEmailReport(body = {}) {
  const settings = buyerInvoiceEmailSettings(body.settings || body);
  if (!body.preview && !body.dryRun && !body.force && !isBuyerInvoiceReportDue(settings)) {
    return {
      sent: false,
      skipped: true,
      reason: 'Current Hong Kong time is outside the configured report schedule.',
      schedule: { weekdays: settings.weekdays, sendTimes: settings.sendTimes, now: hongKongScheduleParts() },
    };
  }
  const reportPayload = { daysAhead: settings.daysAhead };
  if (settings.hasBuyerTraderFilter) reportPayload.buyerTraders = settings.buyerTraders;
  const report = await salesforceBuyerInvoicesDue(reportPayload);
  const email = buildBuyerInvoiceReportEmail(report, settings);
  if (body.preview || body.dryRun) {
    return {
      sent: false,
      preview: true,
      settings: { ...settings, to: settings.to, cc: settings.cc },
      report: {
        rows: report.rows,
        today: report.today,
        dueThrough: report.dueThrough,
        daysAhead: report.daysAhead,
        buyerTraderOptions: report.buyerTraderOptions,
        selectedBuyerTraders: report.selectedBuyerTraders,
        hasBuyerTraderFilter: report.hasBuyerTraderFilter,
      },
      email: { subject: email.subject, html: email.html, text: email.text, totals: email.totals },
    };
  }
  const credentials = body.credentials || {};
  const useSmtp = credentials.method === 'smtp' || credentials.smtp || (!process.env.RESEND_API_KEY && process.env.SMTP_HOST);
  const result = useSmtp
    ? await sendWithSmtp({
        smtp: credentials.smtp || credentials,
        from: settings.from,
        to: settings.to,
        cc: settings.cc,
        subject: email.subject,
        html: email.html,
        text: email.text,
      })
    : await sendWithResend({
        from: settings.from,
        to: settings.to,
        cc: settings.cc,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
  return {
    sent: true,
    id: result.id,
    to: settings.to,
    cc: settings.cc,
    subject: email.subject,
    rows: report.rows.length,
    totals: email.totals,
  };
}

async function salesforceDisputeStems(body) {
  const limit = Math.max(100, Math.min(Number(body.limit) || 5000, 10000));
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);
  const hasDispute = fieldNames.includes('Dispute__c');
  const hasDisputeStatus = fieldNames.includes('Dispute_Status__c');
  if (!hasDispute && !hasDisputeStatus) return { rows: [] };

  const fields = ['Id', 'Name', 'CreatedDate', 'LastModifiedDate'];
  for (const field of [
    'KeyStem__c',
    'Delivery_Date__c',
    'Expected_Delivery_Date__c',
    'ETA_Start_Date__c',
    'Buyer_Name__c',
    'Buyer__c',
    'Dispute__c',
    'Dispute_Status__c',
    'Dispute_Type__c',
    'Dispute_Particular__c',
    'Total_Invoice_Amount__c',
    'Total_Invoiced_Amount_From_Suppliers__c',
    'Receivable_Balance__c',
  ]) {
    if (fieldNames.includes(field)) fields.push(field);
  }
  if (fieldNames.includes('Vessel__c')) fields.push('Vessel__r.Name');
  if (fieldNames.includes('Port__c')) fields.push('Port__r.Name');
  if (fieldNames.includes('Account__c')) fields.push('Account__r.Name');

  const activeDisputeStatusCondition = "(Dispute_Status__c != null AND Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != 'no dispute')";
  const disputeCondition = hasDisputeStatus
    ? activeDisputeStatusCondition
    : 'Dispute__c = true';
  const rows = await queryRows(`
    SELECT ${[...new Set(fields)].join(', ')}
    FROM stem__c
    WHERE ${disputeCondition}
    ORDER BY LastModifiedDate DESC
    LIMIT ${limit}
  `, { limit, softFail: true });

  return {
    rows: rows
      .filter((stem) => !hasDisputeStatus || String(stem.Dispute_Status__c || '').toLowerCase() !== 'no dispute')
      .map((stem) => ({
        ...stem,
        _Display_Name: formatStemName(stem),
        _Buyer_Name: stem.Buyer_Name__c || stem['Account__r']?.Name || stem.Buyer__c || null,
        _Effective_Date: stem.Delivery_Date__c || stem.Expected_Delivery_Date__c || null,
      })),
  };
}

async function salesforceStemDetailFull(body) {
  const { stemId, updates, childObject, childId, childUpdates } = body;
  if (!stemId) throw new Error('stemId required');

  let actualStemId = stemId;
  if (stemId.length < 15) {
    const lookup = await queryRows(`SELECT Id FROM stem__c WHERE KeyStem__c = '${escapeSoql(stemId)}' LIMIT 1`, { softFail: true });
    if (!lookup.length) throw new Error(`STEM with KeyStem__c '${stemId}' not found`);
    actualStemId = lookup[0].Id;
  }

  if (childObject && childId && childUpdates && Object.keys(childUpdates).length > 0) {
    await sfRequest(`/sobjects/${childObject}/${childId}`, { method: 'PATCH', body: childUpdates });
  }
  if (updates && Object.keys(updates).length > 0) {
    await sfRequest(`/sobjects/stem__c/${actualStemId}`, { method: 'PATCH', body: updates });
  }

  const [recordRaw, lineItems, extraCosts, buyerBrokers] = await Promise.all([
    sfRequest(`/sobjects/stem__c/${actualStemId}`).then(cleanRecord),
    queryRows(`SELECT Id, Name, Product__c, Product__r.Name, Product__r.Family, Supplier_Name__c, BDN_Company__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c, Price_Per_Unit__c, Cost_Per_Unit__c, Unit_Sell_At__c, Unit_Buy_At__c, Unit_Cost__c, Subtotal_Sell_At__c, Subtotal_Buy_At__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Payment_Term__c, BDN_Number__c, Cancelled__c, Buyers_Brokers_Commission_Per_Unit__c, Commission_Cost__c, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Suppliers_Brokers_Commission_Lumpsum__c, Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c FROM STEM_Line_Item__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
    queryRows(`SELECT Id, Name, Description__c, Product2Id__c, Product2Id__r.Name, Product2Id__r.Family, Supplier_Name__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_in_MT__c, Quantity_Range_Max__c, Is_Quantity_Range__c, Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Supplier_Issued__c, Payment_Term__c, Cancelled__c FROM STEM_Extra_Cost__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
    queryRows(`SELECT Id, Buyer_Broker__c, Refcode_Index__c, Exported__c, Commission_Lumpsum__c, STEM_Line_Item__r.Id FROM STEM_Buyer_Broker__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
  ]);

  const [vesselName, portName, agentName, accountName, buyerBrokerName, factoringInvoiceName] = await Promise.all([
    recordRaw.Vessel__c ? resolveViaQuery('Vessel__c', recordRaw.Vessel__c, 'Name') : Promise.resolve(null),
    recordRaw.Port__c ? resolveViaQuery('Port__c', recordRaw.Port__c, 'Name') : Promise.resolve(null),
    recordRaw.Agent__c ? resolveViaQuery('Account', recordRaw.Agent__c, 'Name') : Promise.resolve(null),
    recordRaw.Account__c ? resolveViaQuery('Account', recordRaw.Account__c, 'Name') : Promise.resolve(null),
    recordRaw.Buyer_Broker__c ? resolveViaQuery('Account', recordRaw.Buyer_Broker__c, 'Name') : Promise.resolve(null),
    recordRaw.Factoring_Invoice__c ? resolveViaQuery('Invoice__c', recordRaw.Factoring_Invoice__c, 'Name') : Promise.resolve(null),
  ]);

  const buyerBrokersWithNames = await Promise.all(
    buyerBrokers.map(async (bb) => ({
      ...bb,
      _Buyer_Broker_Name: bb.Buyer_Broker__c ? await resolveViaQuery('Account', bb.Buyer_Broker__c, 'Name') : null,
    }))
  );

  const supplierBrokerIds = [...new Set(lineItems.map((li) => li.Supplier_Broker__c).filter(Boolean))];
  const supplierBrokerNameMap = {};
  await Promise.all(supplierBrokerIds.map(async (id) => {
    supplierBrokerNameMap[id] = await resolveViaQuery('Account', id, 'Name');
  }));

  const stemHasDelivery = !!recordRaw.Delivery_Date__c;
  const lineItemsWithNames = lineItems.map((li) => {
    const calculatedQuantity = financialQuantity(li, stemHasDelivery);
    const calculatedSell = lineSellAmount(li, stemHasDelivery);
    const calculatedBuy = lineBuyAmount(li, stemHasDelivery);
    return {
      ...li,
      _Financial_Quantity: calculatedQuantity,
      _Financial_Quantity_Unit: 'MT',
      ...(!stemHasDelivery ? {
        Total_Price__c: calculatedSell,
        Total_Cost__c: calculatedBuy,
      } : {}),
      _Product_Name: li['Product__r']?.Name ?? null,
      _Supplier_Broker_Name: li.Supplier_Broker__c ? supplierBrokerNameMap[li.Supplier_Broker__c] : null,
    };
  });
  const extraCostsWithNames = extraCosts.map((ec) => {
    const calculatedQuantity = financialQuantity(ec, stemHasDelivery, 'Quantity_Range_Max__c');
    const calculatedSell = extraSellAmount(ec, stemHasDelivery);
    const calculatedBuy = extraBuyAmount(ec, stemHasDelivery);
    return {
      ...ec,
      _Financial_Quantity: calculatedQuantity,
      _Financial_Quantity_Unit: 'MT',
      ...(!stemHasDelivery ? {
        Line_Total__c: calculatedSell,
        Line_Total_Buy__c: calculatedBuy,
      } : {}),
      _Product_Name: ec['Product2Id__r']?.Name ?? null,
    };
  });
  const calculatedLineItemSell = lineItems.reduce((sum, li) => {
    if (li.Cancelled__c) return sum;
    return sum + lineSellAmount(li, stemHasDelivery);
  }, 0);
  const calculatedExtraCostSell = extraCosts.reduce((sum, ec) => {
    if (ec.Cancelled__c) return sum;
    return sum + extraSellAmount(ec, stemHasDelivery);
  }, 0);
  const calculatedUndatedBuyerInvoice = calculatedLineItemSell + calculatedExtraCostSell;
  const shouldUseCalculatedBuyerInvoice = !recordRaw.Delivery_Date__c
    && calculatedUndatedBuyerInvoice > 0;
  const activeLineItems = lineItems.filter((li) => !li.Cancelled__c);
  const supplierInvoiceTotal = recordRaw.Total_Invoiced_Amount_From_Suppliers__c ?? 0;
  const supplierLineBuyTotal = activeLineItems.reduce((sum, li) => sum + lineBuyAmount(li, stemHasDelivery), 0);
  const uninvoicedSupplierLineBuyTotal = activeLineItems.reduce((sum, li) => li.Supplier_Invoice__c ? sum : sum + lineBuyAmount(li, stemHasDelivery), 0);
  const hasSupplierInvoiceLines = activeLineItems.some((li) => li.Supplier_Invoice__c);
  const calculatedSupplierInvoice = supplierInvoiceTotal + (hasSupplierInvoiceLines ? uninvoicedSupplierLineBuyTotal : supplierLineBuyTotal);

  const record = {
    ...recordRaw,
    Total_Invoice_Amount__c: shouldUseCalculatedBuyerInvoice
      ? calculatedUndatedBuyerInvoice
      : recordRaw.Total_Invoice_Amount__c,
    _Supplier_Invoice_Amount: calculatedSupplierInvoice,
    _Buyer_Name: recordRaw.Buyer_Name__c || accountName || recordRaw.Buyer__c || null,
    _Vessel_Name: vesselName,
    _Port_Name: portName,
    _Agent_Name: agentName,
    _Account_Name: accountName,
    _Buyer_Broker_Name: buyerBrokerName,
    _Factoring_Invoice_Name: factoringInvoiceName,
  };

  return { record, lineItems: lineItemsWithNames, extraCosts: extraCostsWithNames, buyerBrokers: buyerBrokersWithNames };
}

function uniquePresentValues(values) {
  return [...new Set(values.filter((value) => value != null && value !== ''))];
}

function singleOrMixed(values) {
  const unique = uniquePresentValues(values);
  if (!unique.length) return null;
  return unique.length === 1 ? unique[0] : 'Mixed';
}

function latestIsoDate(values) {
  const dates = uniquePresentValues(values).filter((value) => /^\d{4}-\d{2}-\d{2}/.test(String(value)));
  return dates.sort().at(-1) || null;
}

function addBrokerProductQuantity(group, row) {
  const productName = row.productName || '—';
  const unit = row.quantityUnit || 'MT';
  const key = `${productName}::${unit}`;
  if (!group._productMap.has(key)) {
    group._productMap.set(key, {
      productName,
      quantity: 0,
      hasQuantity: false,
      unit,
    });
  }
  const item = group._productMap.get(key);
  const qty = numericValue(row.bdnQuantity);
  if (qty != null) {
    item.quantity += qty;
    item.hasQuantity = true;
  }
}

function combineBrokerCommissionRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const brokerKey = row.brokerId || row.brokerName || '';
    const key = [row.stemId, row.brokerType, brokerKey].join('::');
    if (!groups.has(key)) {
      groups.set(key, {
        ...row,
        id: `${row.brokerType}-${row.stemId}-${brokerKey}`.replace(/\s+/g, '-'),
        commissionAmount: 0,
        _productMap: new Map(),
        _commissionUnitPrices: [],
        _commissionUnitLines: [],
        _paymentDates: [],
        _paymentDateLabels: [],
        _paymentDelays: [],
        _paymentStatuses: [],
      });
    }
    const group = groups.get(key);
    group.commissionAmount += Number(row.commissionAmount || 0);
    if (row.commissionUnitPrice != null) group._commissionUnitPrices.push(Number(row.commissionUnitPrice));
    group._commissionUnitLines.push({
      productName: row.productName || '—',
      value: numericValue(row.commissionUnitPrice),
    });
    if (row.paymentDate) group._paymentDates.push(row.paymentDate);
    if (row.paymentDateLabel) group._paymentDateLabels.push(row.paymentDateLabel);
    if (row.paymentDelay != null) group._paymentDelays.push(Number(row.paymentDelay));
    if (row.paymentStatus) group._paymentStatuses.push(row.paymentStatus);
    addBrokerProductQuantity(group, row);
  }

  return [...groups.values()].map((group) => {
    const unitPrices = uniquePresentValues(group._commissionUnitPrices);
    const paymentDates = uniquePresentValues(group._paymentDates);
    const paymentDelays = uniquePresentValues(group._paymentDelays);
    const commissionUnitPriceLines = group._commissionUnitLines.map((item) => ({
      productName: item.productName,
      value: item.value,
      label: item.value != null ? `${money(item.value)} / MT` : '—',
    }));
    const productQuantities = [...group._productMap.values()].map((item) => ({
      productName: item.productName,
      quantity: item.hasQuantity ? item.quantity : null,
      quantityUnit: item.unit,
      label: item.hasQuantity ? `${item.productName} ${formatQuantityLabel(item.quantity, item.unit)}` : item.productName,
    }));
    return {
      ...group,
      productName: productQuantities.map((item) => item.productName).join('; '),
      bdnQuantity: productQuantities.length === 1 ? productQuantities[0].quantity : null,
      quantityUnit: productQuantities.length === 1 ? productQuantities[0].quantityUnit : 'MT',
      productQuantities,
      productQuantityLabel: productQuantities.map((item) => item.label).join('; '),
      commissionUnitPrice: unitPrices.length === 1 ? unitPrices[0] : null,
      commissionUnitPriceLines,
      commissionUnitPriceLabel: commissionUnitPriceLines.map((item) => item.label).join('; '),
      paymentDate: paymentDates.length <= 1 ? paymentDates[0] || null : 'Mixed',
      paymentDateSort: latestIsoDate(paymentDates),
      paymentDateLabel: singleOrMixed(group._paymentDateLabels) || group.paymentDateLabel,
      paymentDelay: paymentDelays.length === 1 ? paymentDelays[0] : null,
      paymentDelayLabel: paymentDelays.length > 1 ? 'Mixed' : null,
      paymentStatus: singleOrMixed(group._paymentStatuses),
      _productMap: undefined,
      _commissionUnitPrices: undefined,
      _commissionUnitLines: undefined,
      _paymentDates: undefined,
      _paymentDateLabels: undefined,
      _paymentDelays: undefined,
      _paymentStatuses: undefined,
    };
  });
}

async function salesforceBrokerRegisterFull(body) {
  const limit = Math.min(Number(body.limit) || 2000, 3000);
  const stems = await queryRows(`
    SELECT Id, Name, Delivery_Date__c, Payment_Date__c, Buyer_Pay_Term_Date__c
    FROM stem__c
    ORDER BY Delivery_Date__c DESC NULLS LAST
    LIMIT ${limit}
  `, { limit });
  const stemMap = Object.fromEntries(stems.map((stem) => [stem.Id, stem]));
  const stemIds = stems.map((stem) => stem.Id);
  if (!stemIds.length) return { rows: [] };

  const [lineItemChunks, buyerBrokerChunks, buyerPaymentChunks, buyerInvoiceChunks] = await Promise.all([
    Promise.all(chunkIds(stemIds).map((chunk) => {
      const ids = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT Id, Name, STEM__c, Product__r.Name, Product__r.Family, Supplier_Invoice__c,
               Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c,
               Quantity_Delivered_Per_BDN__c, Quantity__c, Quantity_in_MT__c, Commission_Cost__c, Cancelled__c,
               Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c,
               Buyers_Brokers_Commission_Lumpsum__c
        FROM STEM_Line_Item__c
        WHERE STEM__c IN (${ids})
        LIMIT 5000
      `, { limit: 5000 });
    })),
    Promise.all(chunkIds(stemIds).map((chunk) => {
      const ids = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT Id, Name, STEM__c, Buyer_Broker__c, Exported__c
        FROM STEM_Buyer_Broker__c
        WHERE STEM__c IN (${ids})
        LIMIT 5000
      `, { limit: 5000 });
    })),
    Promise.all(chunkIds(stemIds).map((chunk) => {
      const ids = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT STEM__c, Date__c
        FROM Payment__c
        WHERE STEM__c IN (${ids}) AND Supplier_Invoice__c = null
        ORDER BY Date__c DESC
        LIMIT 5000
      `, { limit: 5000 });
    })),
    Promise.all(chunkIds(stemIds).map((chunk) => {
      const ids = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT STEM__c, Invoice_Due_Date__c
        FROM Invoice__c
        WHERE STEM__c IN (${ids})
        ORDER BY Invoice_Due_Date__c DESC
        LIMIT 5000
      `, { limit: 5000 });
    })),
  ]);

  const lineItems = lineItemChunks.flat();
  const buyerBrokers = buyerBrokerChunks.flat();
  const buyerPayments = buyerPaymentChunks.flat();
  const buyerInvoices = buyerInvoiceChunks.flat();
  const accountIds = [...new Set([
    ...lineItems.map((item) => item.Supplier_Broker__c).filter(Boolean),
    ...lineItems.map((item) => item.Buyers_Broker__c || item.Buyer_Broker__c).filter(Boolean),
    ...buyerBrokers.map((item) => item.Buyer_Broker__c).filter(Boolean),
  ])];

  const accountChunks = await Promise.all(chunkIds(accountIds).map((chunk) => {
    const ids = chunk.map((id) => `'${id}'`).join(',');
    return ids ? queryRows(`SELECT Id, Name, Hidden_Broker__c, Hidden_Broker_Company__c FROM Account WHERE Id IN (${ids})`, { softFail: true }) : Promise.resolve([]);
  }));
  const accountMap = {};
  const accountFlagMap = {};
  for (const account of accountChunks.flat()) {
    const flags = {
      hiddenBrokerIndividual: account.Hidden_Broker__c === true,
      hiddenBrokerCompany: account.Hidden_Broker_Company__c === true,
    };
    accountMap[account.Id] = account.Name;
    accountMap[String(account.Id).slice(0, 15)] = account.Name;
    accountFlagMap[account.Id] = flags;
    accountFlagMap[String(account.Id).slice(0, 15)] = flags;
  }

  const supplierInvoiceIds = [...new Set(lineItems.map((item) => item.Supplier_Invoice__c).filter(Boolean))];
  const paymentDateByInvoice = {};
  const paymentChunks = await Promise.all(chunkIds(supplierInvoiceIds).map((chunk) => {
    const ids = chunk.map((id) => `'${id}'`).join(',');
    return ids ? queryRows(`SELECT Supplier_Invoice__c, Date__c FROM Payment__c WHERE Supplier_Invoice__c IN (${ids}) ORDER BY Date__c DESC`, { softFail: true }) : Promise.resolve([]);
  }));
  for (const payment of paymentChunks.flat()) {
    if (payment.Supplier_Invoice__c && !paymentDateByInvoice[payment.Supplier_Invoice__c]) paymentDateByInvoice[payment.Supplier_Invoice__c] = payment.Date__c;
  }

  const buyerPaymentDateByStem = {};
  for (const payment of buyerPayments) {
    if (payment.STEM__c && !buyerPaymentDateByStem[payment.STEM__c]) buyerPaymentDateByStem[payment.STEM__c] = payment.Date__c;
  }
  const buyerInvoiceDueDateByStem = {};
  for (const invoice of buyerInvoices) {
    if (invoice.STEM__c && !buyerInvoiceDueDateByStem[invoice.STEM__c]) buyerInvoiceDueDateByStem[invoice.STEM__c] = invoice.Invoice_Due_Date__c;
  }

  const buyerStatusByStemBroker = {};
  const buyerStatusByStem = {};
  const buyerBrokersByStem = {};
  for (const item of buyerBrokers) {
    const status = item.Exported__c ? 'Exported' : 'Pending';
    if (item.STEM__c && item.Buyer_Broker__c) buyerStatusByStemBroker[`${item.STEM__c}:${item.Buyer_Broker__c}`] = status;
    if (item.STEM__c) buyerStatusByStem[item.STEM__c] = status;
    if (!item.STEM__c) continue;
    if (!buyerBrokersByStem[item.STEM__c]) buyerBrokersByStem[item.STEM__c] = [];
    buyerBrokersByStem[item.STEM__c].push(item);
  }

  const rawRows = [];
  for (const item of lineItems) {
    const stem = stemMap[item.STEM__c];
    if (!stem) continue;
    const qty = financialQuantity(item, !!stem.Delivery_Date__c);
    const supplierAmount = item.Cancelled__c ? 0 : brokerAmount(item.Suppliers_Brokers_Commission_Per_Unit__c, qty);
    if (item.Supplier_Broker__c && supplierAmount !== 0) {
      rawRows.push({
        id: `supplier-${item.Id}`,
        stemId: item.STEM__c,
        stemName: stem.Name,
        brokerId: item.Supplier_Broker__c,
        productName: item['Product__r']?.Name || item.Name || '—',
        bdnQuantity: qty || null,
        quantityUnit: 'MT',
        deliveryDate: stem.Delivery_Date__c,
        brokerType: 'Supplier Broker',
        brokerName: accountMap[item.Supplier_Broker__c] || item.Supplier_Broker__c,
        hiddenBrokerIndividual: accountFlagMap[item.Supplier_Broker__c]?.hiddenBrokerIndividual || false,
        hiddenBrokerCompany: accountFlagMap[item.Supplier_Broker__c]?.hiddenBrokerCompany || false,
        commissionUnitPrice: item.Suppliers_Brokers_Commission_Per_Unit__c ?? null,
        commissionAmount: supplierAmount,
        paymentDate: paymentDateByInvoice[item.Supplier_Invoice__c] || null,
        paymentDateLabel: 'Paid Date',
        paymentStatus: null,
      });
    }

    const buyerBrokerId = item.Buyers_Broker__c || item.Buyer_Broker__c;
    const hasSupplierBrokerUnit = Number(item.Suppliers_Brokers_Commission_Per_Unit__c || 0) !== 0;
    const buyerPerUnitAmount = brokerAmount(item.Buyers_Brokers_Commission_Per_Unit__c, qty);
    const buyerLumpsumAmount = Number(item.Buyers_Brokers_Commission_Lumpsum__c || 0);
    const buyerAmount = buyerLumpsumAmount || buyerPerUnitAmount;
    if (buyerBrokerId && buyerAmount !== 0) {
      rawRows.push({
        id: `buyer-${item.Id}`,
        stemId: item.STEM__c,
        stemName: stem.Name,
        brokerId: buyerBrokerId,
        productName: item['Product__r']?.Name || item.Name || '—',
        bdnQuantity: qty || null,
        quantityUnit: 'MT',
        deliveryDate: stem.Delivery_Date__c,
        brokerType: 'Buyer Broker',
        brokerName: accountMap[buyerBrokerId] || buyerBrokerId,
        hiddenBrokerIndividual: accountFlagMap[buyerBrokerId]?.hiddenBrokerIndividual || false,
        hiddenBrokerCompany: accountFlagMap[buyerBrokerId]?.hiddenBrokerCompany || false,
        commissionUnitPrice: item.Buyers_Brokers_Commission_Per_Unit__c ?? (qty ? buyerAmount / qty : null),
        commissionAmount: buyerAmount,
        paymentDate: stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c] || null,
        paymentDateLabel: 'Received Date',
        paymentDelay: paymentDelayDays(stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c], buyerInvoiceDueDateByStem[item.STEM__c] || stem.Buyer_Pay_Term_Date__c),
        paymentStatus: buyerStatusByStemBroker[`${item.STEM__c}:${buyerBrokerId}`] || buyerStatusByStem[item.STEM__c] || 'Pending',
      });
    }

    const secondaryAmount = !hasSupplierBrokerUnit && item.Commission_Cost__c != null ? Number(item.Commission_Cost__c || 0) - buyerPerUnitAmount : 0;
    const secondaryBrokers = (buyerBrokersByStem[item.STEM__c] || []).filter((broker) => {
      if (!broker.Buyer_Broker__c) return true;
      if (!buyerBrokerId) return true;
      return String(broker.Buyer_Broker__c).slice(0, 15) !== String(buyerBrokerId).slice(0, 15);
    });
    if (secondaryAmount > 0 && secondaryBrokers.length > 0) {
      for (const broker of secondaryBrokers) {
        rawRows.push({
          id: `secondary-${item.Id}-${broker.Id}`,
          stemId: item.STEM__c,
          stemName: stem.Name,
          brokerId: broker.Buyer_Broker__c || null,
          productName: item['Product__r']?.Name || item.Name || '—',
          bdnQuantity: qty || null,
          quantityUnit: 'MT',
          deliveryDate: stem.Delivery_Date__c,
          brokerType: 'Secondary Buyer Broker',
          brokerName: accountMap[broker.Buyer_Broker__c] || broker.Buyer_Broker__c || 'Secondary Buyer Broker',
          hiddenBrokerIndividual: accountFlagMap[broker.Buyer_Broker__c]?.hiddenBrokerIndividual || false,
          hiddenBrokerCompany: accountFlagMap[broker.Buyer_Broker__c]?.hiddenBrokerCompany || false,
          commissionUnitPrice: qty ? secondaryAmount / qty : null,
          commissionAmount: secondaryAmount,
          paymentDate: stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c] || null,
          paymentDateLabel: 'Received Date',
          paymentDelay: paymentDelayDays(stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c], buyerInvoiceDueDateByStem[item.STEM__c] || stem.Buyer_Pay_Term_Date__c),
          paymentStatus: buyerStatusByStemBroker[`${item.STEM__c}:${broker.Buyer_Broker__c}`] || 'Pending',
        });
      }
    }
  }

  const rows = combineBrokerCommissionRows(rawRows);
  rows.sort((a, b) => String(b.deliveryDate || '').localeCompare(String(a.deliveryDate || '')));
  return { rows };
}

const handlers = {
  salesforceSchema,
  salesforceObjectFields,
  salesforceQuery,
  salesforceFullSchema,
  salesforceDashboard,
  salesforceDashboardFiltered: salesforceDashboardFilteredFull,
  salesforceStemDetail: salesforceStemDetailFull,
  salesforceDescribeChildren,
  salesforceTopBuyers,
  salesforceBrokerRegister: salesforceBrokerRegisterFull,
  salesforceBuyerInvoicesDue,
  outstandingBuyerInvoicesEmailReport,
  salesforceDisputeStems,
  stemPnl: stemPnlFull,
};

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const name = url.pathname.split('/').pop();
    const fn = handlers[name];
    if (!fn) return sendJson(res, { error: `Unknown function: ${name}` }, 404);
    const body = await readBody(req);
    const data = await fn(body);
    return sendJson(res, data);
  } catch (error) {
    return sendJson(res, { error: error.message }, 500);
  }
}
