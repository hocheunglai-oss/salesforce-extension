import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

async function sfQuery(accessToken, soql) {
  try {
    const encoded = encodeURIComponent(soql);
    const res = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/query/?q=${encoded}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    if (data.errorCode || (Array.isArray(data) && data[0]?.errorCode)) {
      return { records: [], totalSize: 0 };
    }
    return { records: data.records || [], totalSize: data.totalSize ?? 0 };
  } catch {
    return { records: [], totalSize: 0 };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { where, trendYear } = body;
    const currentYear = Number(trendYear) || new Date().getFullYear();

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    // Describe stem__c to know available fields
    const describeRes = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/stem__c/describe/`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const describeData = await describeRes.json();
    const fieldNames = (describeData.fields || []).map(f => f.name);

    const hasStatus = fieldNames.includes('Status__c');
    const hasType = fieldNames.includes('Type__c');
    const hasDispute = fieldNames.includes('Dispute__c');

    // Detect account field
    const accountField = fieldNames.includes('Account__c') ? 'Account__c'
      : fieldNames.includes('AccountId') ? 'AccountId'
      : null;

    // Buyer invoice = Total Invoice Amount (buyer)
    const buyerAmountField = fieldNames.includes('Total_Invoice_Amount__c') ? 'Total_Invoice_Amount__c' : null;

    // Supplier invoice = Total Invoiced Amount From Suppliers
    const supplierAmountField = fieldNames.includes('Total_Invoiced_Amount_From_Suppliers__c') ? 'Total_Invoiced_Amount_From_Suppliers__c' : null;

    // Total costs field
    const totalCostsField = fieldNames.includes('Costs_Total__c') ? 'Costs_Total__c' : null;

    const whereClause = where ? `WHERE ${where}` : '';

    // Detect buyer name field
    const buyerNameField = fieldNames.includes('Buyer_Name__c') ? 'Buyer_Name__c'
      : fieldNames.includes('Buyer__c') ? 'Buyer__c'
      : null;

    // P&L report fields: Name, CreatedDate, Delivery Date, Buyer Name, Buyer Invoice, Supplier Invoice, Total Costs
    const plFields = ['Id', 'Name', 'CreatedDate'];
    if (fieldNames.includes('Delivery_Date__c')) plFields.push('Delivery_Date__c');
    if (buyerNameField) plFields.push(buyerNameField);
    if (buyerAmountField) plFields.push(buyerAmountField);
    if (supplierAmountField) plFields.push(supplierAmountField);
    if (totalCostsField) plFields.push(totalCostsField);
    if (fieldNames.includes('KeyStem__c')) plFields.push('KeyStem__c');
    const usefulFields = plFields;

    const queries = [
      // 0: total stem count
      sfQuery(accessToken, `SELECT COUNT(Id) total FROM stem__c ${whereClause}`),
      // 1: by status
      hasStatus
        ? sfQuery(accessToken, `SELECT Status__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Status__c`)
        : Promise.resolve({ records: [] }),
      // 2: by type
      hasType
        ? sfQuery(accessToken, `SELECT Type__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Type__c`)
        : Promise.resolve({ records: [] }),
      // 3: recent records (with P&L fields)
      sfQuery(accessToken, `SELECT ${usefulFields.join(', ')} FROM stem__c ${whereClause} ORDER BY Delivery_Date__c DESC LIMIT 3000`),
      // 4: disputed count
      hasDispute
        ? sfQuery(accessToken, `SELECT COUNT(Id) total FROM stem__c WHERE Dispute__c = true${where ? ` AND (${where})` : ''}`)
        : Promise.resolve({ records: [] }),
      // 5: count distinct accounts (via GROUP BY)
      accountField
        ? sfQuery(accessToken, `SELECT ${accountField} acct, COUNT(Id) cnt FROM stem__c ${whereClause} GROUP BY ${accountField}`)
        : Promise.resolve({ records: [] }),
      // 6: sum buyer invoices
      buyerAmountField
        ? sfQuery(accessToken, `SELECT SUM(${buyerAmountField}) total FROM stem__c ${whereClause}`)
        : Promise.resolve({ records: [] }),
      // 7: sum supplier invoices
      supplierAmountField
        ? sfQuery(accessToken, `SELECT SUM(${supplierAmountField}) total FROM stem__c ${whereClause}`)
        : Promise.resolve({ records: [] }),
      // 8: sum total costs
      totalCostsField
        ? sfQuery(accessToken, `SELECT SUM(${totalCostsField}) total FROM stem__c ${whereClause}`)
        : Promise.resolve({ records: [] }),
      // 9: all stems with financial fields (no limit) for accurate profit sum
      sfQuery(accessToken, `SELECT Id, ${buyerAmountField || 'Total_Invoice_Amount__c'}, ${supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c'}, ${totalCostsField || 'Costs_Total__c'} FROM stem__c ${whereClause} LIMIT 3000`),
      // 10: current year stems for monthly Net P&L trend
      sfQuery(accessToken, `SELECT Id, Delivery_Date__c, ${buyerAmountField || 'Total_Invoice_Amount__c'}, ${supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c'} FROM stem__c WHERE Delivery_Date__c >= ${currentYear}-01-01 AND Delivery_Date__c <= ${currentYear}-12-31 LIMIT 3000`),
    ];

    const results = await Promise.allSettled(queries);
    const getValue = (r) => r.status === 'fulfilled' ? r.value : { records: [], totalSize: 0 };

    const totalRes          = getValue(results[0]);
    const statusRes         = getValue(results[1]);
    const typeRes           = getValue(results[2]);
    const recentRes         = getValue(results[3]);
    const disputedRes       = getValue(results[4]);
    const accountsRes       = getValue(results[5]);
    const buyerRes          = getValue(results[6]);
    const supplierRes       = getValue(results[7]);
    const costsRes          = getValue(results[8]);
    const allStemsRes       = getValue(results[9]);
    const monthlyStemsRes   = getValue(results[10]);

    // Fetch line items for broker commissions using explicit stem IDs (avoids semi-join scope issues)
    const allStemIds = [...new Set([
      ...(allStemsRes.records || []).map(s => s.Id),
      ...(monthlyStemsRes.records || []).map(s => s.Id),
    ])];
    const chunkIds = (ids, size = 200) => {
      const chunks = [];
      for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
      return chunks;
    };
    let lineItemsRes = { records: [] };
    let buyerBrokersRes = { records: [] };
    if (allStemIds.length > 0) {
      const [lineItemChunks, buyerBrokerChunks] = await Promise.all([
        Promise.all(chunkIds(allStemIds).map(chunk => {
          const inList = chunk.map(id => `'${id}'`).join(',');
          return sfQuery(accessToken, `SELECT STEM__c, Buyers_Brokers_Commission_Per_Unit__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Suppliers_Brokers_Commission_Per_Unit__c FROM STEM_Line_Item__c WHERE STEM__c IN (${inList}) LIMIT 2000`);
        })),
        Promise.all(chunkIds(allStemIds).map(chunk => {
          const inList = chunk.map(id => `'${id}'`).join(',');
          return sfQuery(accessToken, `SELECT STEM__c, Commission_Lumpsum__c FROM STEM_Buyer_Broker__c WHERE STEM__c IN (${inList}) LIMIT 2000`);
        })),
      ]);
      lineItemsRes = { records: lineItemChunks.flatMap(c => c.records || []) };
      buyerBrokersRes = { records: buyerBrokerChunks.flatMap(c => c.records || []) };
    }

    // Build per-stem broker commission maps from line items + buyer broker lumpsums
    const brokerByStem = {};
    for (const li of (lineItemsRes.records || [])) {
      const id = li.STEM__c;
      if (!id) continue;
      if (!brokerByStem[id]) brokerByStem[id] = { buyerComm: 0, suppCommPerUnit: 0, suppBrokerName: null, buyerBrokerName: null };
      const brokerQty = li.Quantity_Delivered_Per_BDN__c != null ? li.Quantity_Delivered_Per_BDN__c : (li.Quantity__c ?? 0);
      brokerByStem[id].buyerComm += (li.Buyers_Brokers_Commission_Per_Unit__c ?? 0) * brokerQty;
      brokerByStem[id].suppCommPerUnit += (li.Suppliers_Brokers_Commission_Per_Unit__c ?? 0) * brokerQty;
      if (!brokerByStem[id].suppBrokerName && li['Supplier_Broker__r']?.Name) {
        brokerByStem[id].suppBrokerName = li['Supplier_Broker__r'].Name;
      }
      if (!brokerByStem[id].buyerBrokerName && li['Buyer_Broker__r']?.Name) {
        brokerByStem[id].buyerBrokerName = li['Buyer_Broker__r'].Name;
      }
    }
    // Add buyer broker lumpsums
    for (const bb of (buyerBrokersRes.records || [])) {
      const id = bb.STEM__c;
      if (!id) continue;
      if (!brokerByStem[id]) brokerByStem[id] = { buyerComm: 0, suppCommPerUnit: 0, suppBrokerName: null, buyerBrokerName: null };
      brokerByStem[id].buyerComm += (bb.Commission_Lumpsum__c ?? 0);
    }

    const recentStems = (recentRes.records || []).map(({ attributes, ...rest }) => {
      const { buyerComm = 0, suppCommPerUnit = 0, suppBrokerName = null, buyerBrokerName = null } = brokerByStem[rest.Id] || {};
      const buyer = rest[buyerAmountField || 'Total_Invoice_Amount__c'];
      const supplier = rest[supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c'];
      const netPnl = buyer && supplier ? buyer - supplier - suppCommPerUnit - buyerComm : null;
      return {
        ...rest,
        _buyerBrokerName: buyerBrokerName,
        _buyerBrokerComm: buyerComm || null,
        _suppBrokerName: suppBrokerName,
        _suppBrokerComm: suppCommPerUnit || null,
        // hidden fields for P&L calc
        __buyerCommCalc: buyerComm,
        __suppCommPerUnitCalc: suppCommPerUnit,
        __netPnlCalc: netPnl,
      };
    });

    // Compute total profit per-stem: skip stems where buyer or supplier invoice is 0/null
    const bf = buyerAmountField || 'Total_Invoice_Amount__c';
    const sf2 = supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c';
    const cf = totalCostsField || 'Costs_Total__c';

    let totalProfit = 0;
    let totalBuyer = 0;
    let totalSupplier = 0;
    let totalCosts = 0;

    for (const stem of (allStemsRes.records || [])) {
      const buyer = stem[bf];
      const supplier = stem[sf2];
      if (!buyer || !supplier) continue; // skip if either is 0/null
      const costs = stem[cf] ?? 0;
      const { buyerComm = 0, suppCommPerUnit = 0 } = brokerByStem[stem.Id] || {};
      const stemPnl = buyer - supplier - suppCommPerUnit - buyerComm;
      totalProfit += stemPnl;
      totalBuyer += buyer;
      totalSupplier += supplier;
      totalCosts += costs;
    }

    // Count distinct non-null accounts
    const accountCount = accountsRes.records
      ? accountsRes.records.filter(r => r.acct != null).length
      : null;

    // Compute top buyers by net P&L from per-stem data
    const buyerPnlMap = {};
    for (const stem of recentStems) {
      const buyerName = stem[buyerNameField] || null;
      if (!buyerName) continue;
      const buyer = stem[bf];
      const supplier = stem[sf2];
      if (!buyer || !supplier) continue;
      const stemPnl = buyer - supplier - (stem.__buyerCommCalc ?? 0) - (stem.__suppCommPerUnitCalc ?? 0);
      if (!buyerPnlMap[buyerName]) buyerPnlMap[buyerName] = 0;
      buyerPnlMap[buyerName] += stemPnl;
    }
    const topBuyersByNetPnl = Object.entries(buyerPnlMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, pnl]) => ({ name, netPnl: pnl }));

    const monthlyTotals = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, netPnl: 0 }));
    for (const stem of (monthlyStemsRes.records || [])) {
      if (!stem.Delivery_Date__c) continue;
      const buyer = stem[bf];
      const supplier = stem[sf2];
      if (!buyer || !supplier) continue;
      const month = Number(String(stem.Delivery_Date__c).split('-')[1]);
      if (!month || month < 1 || month > 12) continue;
      const { buyerComm = 0, suppCommPerUnit = 0 } = brokerByStem[stem.Id] || {};
      monthlyTotals[month - 1].netPnl += buyer - supplier - suppCommPerUnit - buyerComm;
    }
    const monthlyNetPnl = monthlyTotals.map(item => ({
      month: item.month,
      label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][item.month - 1],
      netPnl: item.netPnl,
    }));

    return Response.json({
      stemTotal: totalRes.records?.[0]?.total ?? 0,
      accountCount,
      totalBuyer,
      totalSupplier,
      totalProfit,
      disputedCount: disputedRes.records?.[0]?.total ?? null,
      stemByStatus: (statusRes.records || []).map(r => ({ label: r.val || 'Unknown', value: r.total })),
      stemByType: (typeRes.records || []).map(r => ({ label: r.val || 'Unknown', value: r.total })),
      recentStems,
      totalCosts,
      buyerAmountField,
      supplierAmountField,
      totalCostsField,
      accountField,
      topBuyersByNetPnl,
      monthlyNetPnl,
      monthlyNetPnlYear: currentYear,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});