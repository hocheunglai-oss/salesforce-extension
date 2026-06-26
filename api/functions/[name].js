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
    sfQuery(`SELECT Id, Name, Product__c, Product__r.Name, Supplier_Name__c, BDN_Company__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Subtotal_Sell_At__c, Subtotal_Buy_At__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Payment_Term__c, BDN_Number__c, Quantity_in_MT__c, Is_Quantity_Range__c, Cancelled__c, Buyers_Brokers_Commission_Per_Unit__c, Commission_Cost__c, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Suppliers_Brokers_Commission_Lumpsum__c, Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c FROM STEM_Line_Item__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { clean: true, softFail: true }),
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
    const lineItems = await sfQuery(`SELECT Id, Name, STEM__c, Product__r.Name, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Quantity_Delivered_Per_BDN__c, Quantity__c, Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c, Buyers_Brokers_Commission_Lumpsum__c, Cancelled__c FROM STEM_Line_Item__c WHERE STEM__c IN (${ids}) LIMIT 5000`, { clean: true, softFail: true });
    for (const item of lineItems.records || []) {
      const stem = stemMap[item.STEM__c];
      if (!stem || item.Cancelled__c) continue;
      const qty = item.Quantity_Delivered_Per_BDN__c ?? item.Quantity__c ?? 0;
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

const TRADER_CODE_NAMES = {
  KZ: 'Kelvin Zeng',
  OL: 'Oleh Kulyk',
  SC: 'Stanley Chui',
  VL: 'Vincent Lee',
};

function formatStemName(stem) {
  const parts = [stem.KeyStem__c, stem['Vessel__r']?.Name, stem['Port__r']?.Name].filter(Boolean);
  return parts.length ? parts.join(' - ') : stem.Name;
}

function formatTraderInCharge(accountManager, ownerName) {
  const codes = String(accountManager || '')
    .split(/[\/,;&\s]+/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  const names = codes.map((code) => TRADER_CODE_NAMES[code] || code);
  if (names.length) return names.join(', ');
  return ownerName && ownerName !== 'Production Support' ? ownerName : null;
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
  const { where, trendYear, disputeOnly } = body;
  const currentYear = Number(trendYear) || new Date().getFullYear();
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);

  const hasStatus = fieldNames.includes('Status__c');
  const hasType = fieldNames.includes('Type__c');
  const hasDispute = fieldNames.includes('Dispute__c');
  const hasDisputeStatus = fieldNames.includes('Dispute_Status__c');
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
  const combinedWhere = [where, disputeCondition].filter(Boolean).map((condition) => `(${condition})`).join(' AND ');
  const whereClause = combinedWhere ? `WHERE ${combinedWhere}` : '';

  const plFields = ['Id', 'Name', 'CreatedDate'];
  if (fieldNames.includes('Delivery_Date__c')) plFields.push('Delivery_Date__c');
  if (expectedDeliveryField) plFields.push(expectedDeliveryField);
  if (fieldNames.includes('ETA_Start_Date__c')) plFields.push('ETA_Start_Date__c');
  if (buyerNameField) plFields.push(buyerNameField);
  if (hasDisputeStatus) plFields.push('Dispute_Status__c');
  if (hasDispute) plFields.push('Dispute__c');
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
      ? queryResult(`SELECT COUNT(Id) total FROM stem__c WHERE Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != null${where ? ` AND (${where})` : ''}`, { softFail: true })
      : hasDispute
        ? queryResult(`SELECT COUNT(Id) total FROM stem__c WHERE Dispute__c = true${where ? ` AND (${where})` : ''}`, { softFail: true })
        : Promise.resolve({ records: [] }),
    accountField ? queryResult(`SELECT ${accountField} acct, COUNT(Id) cnt FROM stem__c ${whereClause} GROUP BY ${accountField}`, { softFail: true }) : Promise.resolve({ records: [] }),
    buyerAmountField ? queryResult(`SELECT SUM(${buyerAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : Promise.resolve({ records: [] }),
    supplierAmountField ? queryResult(`SELECT SUM(${supplierAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : Promise.resolve({ records: [] }),
    totalCostsField ? queryResult(`SELECT SUM(${totalCostsField}) total FROM stem__c ${whereClause}`, { softFail: true }) : Promise.resolve({ records: [] }),
    queryResult(`SELECT Id, Delivery_Date__c, ${buyerAmountField || 'Total_Invoice_Amount__c'}, ${supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c'}, ${totalCostsField || 'Costs_Total__c'}, QLIK_STEM_Line_Item_Total_Cost__c, QLIK_Costs_Total_Cost__c FROM stem__c ${whereClause} LIMIT 3000`, { limit: 3000, softFail: true }),
    queryResult(`SELECT Id, Delivery_Date__c${expectedDeliveryField ? `, ${expectedDeliveryField}` : ''}, ${buyerNameField ? `${buyerNameField}, ` : ''}${buyerAmountField || 'Total_Invoice_Amount__c'}, ${supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c'}, QLIK_STEM_Line_Item_Total_Cost__c, QLIK_Costs_Total_Cost__c FROM stem__c WHERE (Delivery_Date__c >= ${currentYear}-01-01 AND Delivery_Date__c <= ${currentYear}-12-31)${expectedDeliveryField ? ` OR (Delivery_Date__c = null AND ${expectedDeliveryField} >= ${currentYear}-01-01 AND ${expectedDeliveryField} <= ${currentYear}-12-31)` : ''} LIMIT 3000`, { limit: 3000, softFail: true }),
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

  let lineItems = [];
  let buyerBrokers = [];
  let extraCosts = [];
  if (allStemIds.length > 0) {
    const [lineItemChunks, buyerBrokerChunks, extraCostChunks] = await Promise.all([
      Promise.all(chunkIds(allStemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${id}'`).join(',');
        return queryRows(`SELECT STEM__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Cancelled__c, Buyers_Brokers_Commission_Per_Unit__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Commission_Cost__c, Suppliers_Brokers_Commission_Per_Unit__c, Supplier_Broker__r.Name, Buyers_Broker__r.Name FROM STEM_Line_Item__c WHERE STEM__c IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
      })),
      Promise.all(chunkIds(allStemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${id}'`).join(',');
        return queryRows(`SELECT STEM__c, Commission_Lumpsum__c FROM STEM_Buyer_Broker__c WHERE STEM__c IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
      })),
      Promise.all(chunkIds(allStemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${id}'`).join(',');
        return queryRows(`SELECT STEM__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Cancelled__c FROM STEM_Extra_Cost__c WHERE STEM__c IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
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
    const buy = ec.Line_Total_Buy__c ?? 0;
    const sell = ec.Line_Total__c ?? 0;
    extraCostSellByStem[ec.STEM__c] = (extraCostSellByStem[ec.STEM__c] || 0) + sell;
    if (ec.Supplier_Invoice__c) invoicedExtraCostBuyByStem[ec.STEM__c] = (invoicedExtraCostBuyByStem[ec.STEM__c] || 0) + buy;
    if (!ec.Supplier_Invoice__c) extraCostBuyByStem[ec.STEM__c] = (extraCostBuyByStem[ec.STEM__c] || 0) + buy;
    if (!ec.Supplier_Invoice__c && buy === 0 && sell > 0) sellOnlyExtraSellByStem[ec.STEM__c] = (sellOnlyExtraSellByStem[ec.STEM__c] || 0) + sell;
  }

  const supplierLineBuyByStem = {};
  const uninvoicedSupplierLineBuyByStem = {};
  const hasSupplierInvoiceByStem = {};
  const brokerByStem = {};
  for (const li of lineItems) {
    const id = li.STEM__c;
    if (!id || li.Cancelled__c) continue;
    lineItemSellByStem[id] = (lineItemSellByStem[id] || 0) + (li.Total_Price__c ?? 0);
    supplierLineBuyByStem[id] = (supplierLineBuyByStem[id] || 0) + (li.Total_Cost__c ?? 0);
    if (!li.Supplier_Invoice__c) {
      uninvoicedSupplierLineBuyByStem[id] = (uninvoicedSupplierLineBuyByStem[id] || 0) + (li.Total_Cost__c ?? 0);
    }
    if (li.Supplier_Invoice__c) hasSupplierInvoiceByStem[id] = true;

    if (!brokerByStem[id]) brokerByStem[id] = { buyerComm: 0, suppCommPerUnit: 0, suppBrokerName: null, buyerBrokerName: null };
    const brokerQty = li.Quantity_Delivered_Per_BDN__c != null ? li.Quantity_Delivered_Per_BDN__c : (li.Quantity__c ?? 0);
    const buyerBrokerPerUnitTotal = (li.Buyers_Brokers_Commission_Per_Unit__c ?? 0) * brokerQty;
    const suppBrokerPerUnit = li.Suppliers_Brokers_Commission_Per_Unit__c ?? 0;
    brokerByStem[id].buyerComm += suppBrokerPerUnit !== 0 ? buyerBrokerPerUnitTotal : (li.Commission_Cost__c ?? buyerBrokerPerUnitTotal);
    brokerByStem[id].suppCommPerUnit += suppBrokerPerUnit * brokerQty;
    if (!brokerByStem[id].suppBrokerName && li['Supplier_Broker__r']?.Name) brokerByStem[id].suppBrokerName = li['Supplier_Broker__r'].Name;
    if (!brokerByStem[id].buyerBrokerName && li['Buyers_Broker__r']?.Name) brokerByStem[id].buyerBrokerName = li['Buyers_Broker__r'].Name;
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

  const recentStems = (recentRes.records || []).map((stem) => {
    const calc = calculateStem(stem);
    return {
      ...stem,
      [bf]: calc.buyer ?? null,
      [sf2]: calc.supplier || null,
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
    if (!buyerName || stem[bf] == null || stem.__netPnlCalc == null) continue;
    buyerPnlMap[buyerName] = (buyerPnlMap[buyerName] || 0) + stem.__netPnlCalc;
  }
  const topBuyersByNetPnl = Object.entries(buyerPnlMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, pnl]) => ({ name, netPnl: pnl }));

  const monthlyTotals = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, netPnl: 0 }));
  const buyerMonthTotals = {};
  for (const stem of monthlyStemsRes.records || []) {
    const effectiveDate = stem.Delivery_Date__c || stem.Expected_Delivery_Date__c;
    if (!effectiveDate) continue;
    const calc = calculateStem(stem);
    if (calc.buyer == null) continue;
    const month = Number(String(effectiveDate).split('-')[1]);
    if (!month || month < 1 || month > 12) continue;
    monthlyTotals[month - 1].netPnl += calc.netPnl || 0;
    if (buyerNameField && stem[buyerNameField]) {
      const buyerName = stem[buyerNameField];
      if (!buyerMonthTotals[buyerName]) buyerMonthTotals[buyerName] = Array(12).fill(0);
      buyerMonthTotals[buyerName][month - 1] += calc.netPnl || 0;
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

  return {
    stemTotal: totalRes.records?.[0]?.total ?? 0,
    accountCount: accountsRes.records ? accountsRes.records.filter((r) => r.acct != null).length : null,
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
    monthlyNetPnl,
    monthlyBuyerNetPnl,
    monthlyBuyerNames,
    monthlyNetPnlYear: currentYear,
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
        SELECT Id, STEM__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Cancelled__c,
               Buyers_Brokers_Commission_Per_Unit__c,
               Buyers_Brokers_Commission_Lumpsum__c,
               Commission_Cost__c,
               Suppliers_Brokers_Commission_Per_Unit__c,
               Supplier_Broker__r.Name
        FROM STEM_Line_Item__c
        WHERE STEM__c IN (${inList})
        LIMIT 2000
      `, { limit: 2000, softFail: true });
    })),
    Promise.all(idChunks.map(() => Promise.resolve([]))),
    Promise.all(idChunks.map((chunk) => {
      const inList = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT STEM__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Cancelled__c
        FROM STEM_Extra_Cost__c
        WHERE STEM__c IN (${inList})
        LIMIT 5000
      `, { limit: 5000, softFail: true });
    })),
  ]);

  const lineItems = lineItemArrays.flat();
  const buyerBrokerItems = buyerBrokerArrays.flat();
  const extraCosts = extraCostArrays.flat();
  const byId = {};
  const initStem = (id) => {
    if (!byId[id]) byId[id] = { suppBrokerComm: 0, buyerBrokerComm: 0, extraCostSell: 0, extraCostBuy: 0, invoicedExtraCostBuy: 0, sellOnlyExtraSell: 0, buyerLineSell: 0, supplierLineBuy: 0, uninvoicedSupplierLineBuy: 0, hasSupplierInvoice: false, suppBrokerName: null };
  };

  for (const li of lineItems) {
    const id = li.STEM__c;
    if (!id) continue;
    initStem(id);
    if (li.Cancelled__c) continue;
    const qty = li.Quantity__c ?? 0;
    const brokerQty = li.Quantity_Delivered_Per_BDN__c != null ? li.Quantity_Delivered_Per_BDN__c : qty;
    byId[id].buyerLineSell += li.Total_Price__c ?? 0;
    byId[id].supplierLineBuy += li.Total_Cost__c ?? 0;
    if (!li.Supplier_Invoice__c) byId[id].uninvoicedSupplierLineBuy += li.Total_Cost__c ?? 0;
    if (li.Supplier_Invoice__c) byId[id].hasSupplierInvoice = true;
    byId[id].suppBrokerComm += (li.Suppliers_Brokers_Commission_Per_Unit__c ?? 0) * brokerQty;
    const buyerBrokerPerUnitTotal = (li.Buyers_Brokers_Commission_Per_Unit__c ?? 0) * brokerQty;
    const suppBrokerPerUnit = li.Suppliers_Brokers_Commission_Per_Unit__c ?? 0;
    byId[id].buyerBrokerComm += suppBrokerPerUnit !== 0 ? buyerBrokerPerUnitTotal : (li.Commission_Cost__c ?? buyerBrokerPerUnitTotal);
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
    const buy = ec.Line_Total_Buy__c ?? 0;
    const sell = ec.Line_Total__c ?? 0;
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
    fields.push('Account__c', 'Account__r.Name', 'Account__r.Account_Manager__c', 'Account__r.Owner.Name');
  }
  if (fieldNames.includes('Payment_Date__c')) fields.push('Payment_Date__c');

  const dueCondition = dueFields
    .map((field) => `(${field} != null AND ${field} <= ${dueThrough})`)
    .join(' OR ');
  const outstandingConditions = [];
  if (fieldNames.includes('Payment_Date__c')) outstandingConditions.push('Payment_Date__c = null');
  if (fieldNames.includes('Receivable_Balance__c')) outstandingConditions.push('Receivable_Balance__c >= 50');
  if (fieldNames.includes('KeyStem__c')) outstandingConditions.push("(KeyStem__c = null OR NOT (KeyStem__c LIKE 'T%'))");
  const whereParts = [`(${dueCondition})`, ...outstandingConditions];

  const stems = await queryRows(`
    SELECT ${[...new Set(fields)].join(', ')}
    FROM stem__c
    WHERE ${whereParts.join(' AND ')}
    ORDER BY ${dueFields[0]} ASC NULLS LAST, Name ASC
    LIMIT ${rowLimit}
  `, { limit: rowLimit, softFail: true });

  const rows = stems
    .map((stem) => {
      const dueDate = earliestDate(dueFields.map((field) => stem[field]));
      if (!dueDate || dueDate > dueThrough) return null;
      if (stem.KeyStem__c && stem.KeyStem__c.startsWith('T')) return null;
      if (stem.Receivable_Balance__c != null && Number(stem.Receivable_Balance__c) < 50) return null;
      const daysUntilDue = daysBetween(today, dueDate);
      const account = stem['Account__r'] || {};
      return {
        id: stem.Id,
        stemId: stem.Id,
        stemName: formatStemName(stem),
        keyStem: stem.KeyStem__c || null,
        buyerName: stem.Buyer_Name__c || account.Name || stem.Buyer__c || null,
        invoiceAmount: stem.Total_Invoice_Amount__c ?? null,
        receivableBalance: stem.Receivable_Balance__c ?? null,
        buyerInvoiceDueDate: dueDate,
        buyerTraderInCharge: formatTraderInCharge(account.Account_Manager__c, account.Owner?.Name),
        daysUntilDue,
        status: daysUntilDue == null ? 'Due' : daysUntilDue < 0 ? 'Overdue' : 'Due Soon',
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.buyerInvoiceDueDate !== b.buyerInvoiceDueDate) return a.buyerInvoiceDueDate.localeCompare(b.buyerInvoiceDueDate);
      return String(a.stemName || '').localeCompare(String(b.stemName || ''));
    });

  return { rows, today, dueThrough, daysAhead };
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
    queryRows(`SELECT Id, Name, Product__c, Product__r.Name, Supplier_Name__c, BDN_Company__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Subtotal_Sell_At__c, Subtotal_Buy_At__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Payment_Term__c, BDN_Number__c, Quantity_in_MT__c, Is_Quantity_Range__c, Cancelled__c, Buyers_Brokers_Commission_Per_Unit__c, Commission_Cost__c, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Suppliers_Brokers_Commission_Lumpsum__c, Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c FROM STEM_Line_Item__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
    queryRows(`SELECT Id, Name, Description__c, Product2Id__c, Product2Id__r.Name, Supplier_Name__c, Quantity__c, Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Supplier_Issued__c, Payment_Term__c, Cancelled__c FROM STEM_Extra_Cost__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
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

  const lineItemsWithNames = lineItems.map((li) => ({
    ...li,
    _Product_Name: li['Product__r']?.Name ?? null,
    _Supplier_Broker_Name: li.Supplier_Broker__c ? supplierBrokerNameMap[li.Supplier_Broker__c] : null,
  }));
  const extraCostsWithNames = extraCosts.map((ec) => ({
    ...ec,
    _Product_Name: ec['Product2Id__r']?.Name ?? null,
  }));
  const calculatedLineItemSell = lineItems.reduce((sum, li) => {
    if (li.Cancelled__c) return sum;
    return sum + (li.Total_Price__c ?? 0);
  }, 0);
  const calculatedExtraCostSell = extraCosts.reduce((sum, ec) => {
    if (ec.Cancelled__c) return sum;
    return sum + (ec.Line_Total__c ?? 0);
  }, 0);
  const calculatedUndatedBuyerInvoice = calculatedLineItemSell + calculatedExtraCostSell;
  const shouldUseCalculatedBuyerInvoice = !recordRaw.Delivery_Date__c
    && calculatedUndatedBuyerInvoice > 0
    && !recordRaw.Total_Invoice_Amount__c;
  const activeLineItems = lineItems.filter((li) => !li.Cancelled__c);
  const supplierInvoiceTotal = recordRaw.Total_Invoiced_Amount_From_Suppliers__c ?? 0;
  const supplierLineBuyTotal = activeLineItems.reduce((sum, li) => sum + (li.Total_Cost__c ?? 0), 0);
  const uninvoicedSupplierLineBuyTotal = activeLineItems.reduce((sum, li) => li.Supplier_Invoice__c ? sum : sum + (li.Total_Cost__c ?? 0), 0);
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
        SELECT Id, Name, STEM__c, Product__r.Name, Supplier_Invoice__c,
               Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c,
               Quantity_Delivered_Per_BDN__c, Quantity__c, Commission_Cost__c, Cancelled__c,
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

  const rows = [];
  for (const item of lineItems) {
    const stem = stemMap[item.STEM__c];
    if (!stem) continue;
    const qty = item.Quantity_Delivered_Per_BDN__c ?? item.Quantity__c;
    const supplierAmount = item.Cancelled__c ? 0 : brokerAmount(item.Suppliers_Brokers_Commission_Per_Unit__c, qty);
    if (item.Supplier_Broker__c && supplierAmount !== 0) {
      rows.push({
        id: `supplier-${item.Id}`,
        stemId: item.STEM__c,
        stemName: stem.Name,
        productName: item['Product__r']?.Name || item.Name || '—',
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
      rows.push({
        id: `buyer-${item.Id}`,
        stemId: item.STEM__c,
        stemName: stem.Name,
        productName: item['Product__r']?.Name || item.Name || '—',
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
        rows.push({
          id: `secondary-${item.Id}-${broker.Id}`,
          stemId: item.STEM__c,
          stemName: stem.Name,
          productName: item['Product__r']?.Name || item.Name || '—',
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
