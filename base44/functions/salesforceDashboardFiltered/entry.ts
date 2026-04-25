import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

async function sfQuery(accessToken, soql) {
  const encoded = encodeURIComponent(soql);
  const res = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/query/?q=${encoded}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (data.errorCode || (Array.isArray(data) && data[0]?.errorCode)) {
    throw new Error(data.message || (Array.isArray(data) && data[0]?.message) || 'Query error');
  }
  return { records: data.records || [], totalSize: data.totalSize ?? 0 };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { where } = body;

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
      sfQuery(accessToken, `SELECT ${usefulFields.join(', ')} FROM stem__c ${whereClause} ORDER BY Delivery_Date__c DESC LIMIT 200`),
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
    ];

    const results = await Promise.allSettled(queries);
    const getValue = (r) => r.status === 'fulfilled' ? r.value : { records: [], totalSize: 0 };

    const totalRes      = getValue(results[0]);
    const statusRes     = getValue(results[1]);
    const typeRes       = getValue(results[2]);
    const recentRes     = getValue(results[3]);
    const disputedRes   = getValue(results[4]);
    const accountsRes   = getValue(results[5]);
    const buyerRes      = getValue(results[6]);
    const supplierRes   = getValue(results[7]);
    const costsRes      = getValue(results[8]);

    const recentStems = (recentRes.records || []).map(({ attributes, ...rest }) => rest);

    // Total profit = SUM(buyer invoice) - SUM(supplier invoice) - SUM(total costs)
    const totalBuyer = buyerRes.records?.[0]?.total ?? null;
    const totalSupplier = supplierRes.records?.[0]?.total ?? null;
    const totalCosts = costsRes.records?.[0]?.total ?? null;
    const totalProfit = (totalBuyer != null && totalSupplier != null)
      ? totalBuyer - totalSupplier - (totalCosts ?? 0)
      : null;

    // Count distinct non-null accounts
    const accountCount = accountsRes.records
      ? accountsRes.records.filter(r => r.acct != null).length
      : null;

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
      // debug info
      buyerAmountField,
      supplierAmountField,
      totalCostsField,
      accountField,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});