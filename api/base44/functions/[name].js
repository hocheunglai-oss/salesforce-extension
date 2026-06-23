import { chunkIds, cleanRecord, sendJson, sfQuery, sfRequest } from '../../../_salesforce.js';

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
  const plFields = ['Id', 'Name', 'CreatedDate'];
  if (fieldNames.includes('Delivery_Date__c')) plFields.push('Delivery_Date__c');
  if (buyerField) plFields.push(buyerField);
  if (buyerAmountField) plFields.push(buyerAmountField);
  if (supplierAmountField) plFields.push(supplierAmountField);
  if (totalCostsField) plFields.push(totalCostsField);
  if (fieldNames.includes('KeyStem__c')) plFields.push('KeyStem__c');

  const [totalRes, recentRes, buyerRes, supplierRes, costsRes, monthlyRes] = await Promise.all([
    sfQuery(`SELECT COUNT(Id) total FROM stem__c ${whereClause}`, { softFail: true }),
    sfQuery(`SELECT ${plFields.join(', ')} FROM stem__c ${whereClause} ORDER BY Delivery_Date__c DESC LIMIT 3000`, { clean: true, limit: 3000, softFail: true }),
    buyerAmountField ? sfQuery(`SELECT SUM(${buyerAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
    supplierAmountField ? sfQuery(`SELECT SUM(${supplierAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
    totalCostsField ? sfQuery(`SELECT SUM(${totalCostsField}) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
    sfQuery(`SELECT Id, Delivery_Date__c${buyerField ? `, ${buyerField}` : ''}${buyerAmountField ? `, ${buyerAmountField}` : ''}${supplierAmountField ? `, ${supplierAmountField}` : ''} FROM stem__c WHERE Delivery_Date__c >= ${currentYear}-01-01 AND Delivery_Date__c <= ${currentYear}-12-31 LIMIT 3000`, { clean: true, limit: 3000, softFail: true }),
  ]);

  const bf = buyerAmountField || 'Total_Invoice_Amount__c';
  const sf = supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c';
  const recentStems = recentRes.records || [];
  const totalBuyer = buyerRes.records?.[0]?.total ?? 0;
  const totalSupplier = supplierRes.records?.[0]?.total ?? 0;
  const totalCosts = costsRes.records?.[0]?.total ?? 0;
  const totalProfit = totalBuyer - totalSupplier;
  const monthlyNetPnl = Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][idx], netPnl: 0 }));
  for (const stem of monthlyRes.records || []) {
    const month = Number(String(stem.Delivery_Date__c || '').split('-')[1]);
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

const handlers = {
  salesforceSchema,
  salesforceObjectFields,
  salesforceQuery,
  salesforceFullSchema,
  salesforceDashboard,
  salesforceDashboardFiltered,
  salesforceStemDetail,
  salesforceDescribeChildren,
  salesforceTopBuyers,
  salesforceBrokerRegister,
  stemPnl,
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
