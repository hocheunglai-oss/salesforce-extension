import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const SF_API_VERSION = 'v60.0';
const FALLBACK_INSTANCE = 'https://fratellicosulich.my.salesforce.com';

async function sfQuery(instanceUrl, accessToken, soql) {
  const encoded = encodeURIComponent(soql);
  let res = await fetch(`${instanceUrl}/services/data/${SF_API_VERSION}/query/?q=${encoded}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  let data = await res.json();
  if (!res.ok || data.errorCode || (Array.isArray(data) && data[0]?.errorCode)) {
    throw new Error(data.message || data[0]?.message || 'Salesforce query failed');
  }

  let records = data.records || [];
  while (data.nextRecordsUrl) {
    res = await fetch(`${instanceUrl}${data.nextRecordsUrl}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    data = await res.json();
    if (!res.ok) throw new Error(data.message || data[0]?.message || 'Salesforce pagination failed');
    records = records.concat(data.records || []);
  }
  return records.map(({ attributes, ...rest }) => rest);
}

function chunkIds(ids, size = 200) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

function brokerAmount(value, qty) {
  const unit = Number(value || 0);
  const quantity = Number(qty || 0);
  return unit * quantity;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 2000, 3000);

    const { accessToken, connectionConfig } = await base44.asServiceRole.connectors.getConnection('salesforce');
    const instanceUrl = connectionConfig?.instance_url || FALLBACK_INSTANCE;

    const stems = await sfQuery(instanceUrl, accessToken, `
      SELECT Id, Name, Delivery_Date__c, Payment_Date__c, Buyer_Pay_Term_Date__c
      FROM stem__c
      ORDER BY Delivery_Date__c DESC NULLS LAST
      LIMIT ${limit}
    `);

    const stemMap = Object.fromEntries(stems.map(stem => [stem.Id, stem]));
    const stemIds = stems.map(stem => stem.Id);
    if (!stemIds.length) return Response.json({ rows: [] });

    const [lineItemChunks, buyerBrokerChunks] = await Promise.all([
      Promise.all(chunkIds(stemIds).map(chunk => {
        const ids = chunk.map(id => `'${id}'`).join(',');
        return sfQuery(instanceUrl, accessToken, `
          SELECT Id, Name, STEM__c, Product__r.Name, Supplier_Invoice__c,
                 Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c,
                 Quantity_Delivered_Per_BDN__c, Quantity__c, Commission_Cost__c,
                 Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c,
                 Buyers_Brokers_Commission_Lumpsum__c
          FROM STEM_Line_Item__c
          WHERE STEM__c IN (${ids})
          LIMIT 5000
        `);
      })),
      Promise.all(chunkIds(stemIds).map(chunk => {
        const ids = chunk.map(id => `'${id}'`).join(',');
        return sfQuery(instanceUrl, accessToken, `
          SELECT Id, Name, STEM__c, Buyer_Broker__c, Exported__c
          FROM STEM_Buyer_Broker__c
          WHERE STEM__c IN (${ids})
          LIMIT 5000
        `);
      })),
    ]);

    const lineItems = lineItemChunks.flat();
    const buyerBrokers = buyerBrokerChunks.flat();
    const accountIds = [...new Set([
      ...lineItems.map(item => item.Supplier_Broker__c).filter(Boolean),
      ...lineItems.map(item => item.Buyers_Broker__c || item.Buyer_Broker__c).filter(Boolean),
      ...buyerBrokers.map(item => item.Buyer_Broker__c).filter(Boolean),
    ])];

    const accountChunks = await Promise.all(chunkIds(accountIds).map(chunk => {
      const ids = chunk.map(id => `'${id}'`).join(',');
      return sfQuery(instanceUrl, accessToken, `SELECT Id, Name, Hidden_Broker__c, Hidden_Broker_Company__c FROM Account WHERE Id IN (${ids})`);
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

    const supplierInvoiceIds = [...new Set(lineItems.map(item => item.Supplier_Invoice__c).filter(Boolean))];
    const paymentDateByInvoice = {};
    const paymentChunks = await Promise.all(chunkIds(supplierInvoiceIds).map(chunk => {
      const ids = chunk.map(id => `'${id}'`).join(',');
      return sfQuery(instanceUrl, accessToken, `SELECT Supplier_Invoice__c, Date__c FROM Payment__c WHERE Supplier_Invoice__c IN (${ids}) ORDER BY Date__c DESC`);
    }));
    for (const payment of paymentChunks.flat()) {
      if (payment.Supplier_Invoice__c && !paymentDateByInvoice[payment.Supplier_Invoice__c]) {
        paymentDateByInvoice[payment.Supplier_Invoice__c] = payment.Date__c;
      }
    }

    const buyerStatusByStemBroker = {};
    const buyerStatusByStem = {};
    for (const item of buyerBrokers) {
      const status = item.Exported__c ? 'Exported' : 'Pending';
      if (item.STEM__c && item.Buyer_Broker__c) buyerStatusByStemBroker[`${item.STEM__c}:${item.Buyer_Broker__c}`] = status;
      if (item.STEM__c) buyerStatusByStem[item.STEM__c] = status;
    }

    const buyerBrokersByStem = {};
    for (const broker of buyerBrokers) {
      if (!broker.STEM__c) continue;
      if (!buyerBrokersByStem[broker.STEM__c]) buyerBrokersByStem[broker.STEM__c] = [];
      buyerBrokersByStem[broker.STEM__c].push(broker);
    }

    const rows = [];
    for (const item of lineItems) {
      const stem = stemMap[item.STEM__c];
      if (!stem) continue;
      const qty = item.Quantity_Delivered_Per_BDN__c ?? item.Quantity__c;
      const supplierAmount = brokerAmount(item.Suppliers_Brokers_Commission_Per_Unit__c, qty);
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
          paymentDate: stem.Buyer_Pay_Term_Date__c,
          paymentDateLabel: 'Received Date',
          paymentStatus: buyerStatusByStemBroker[`${item.STEM__c}:${buyerBrokerId}`] || buyerStatusByStem[item.STEM__c] || 'Pending',
        });
      }

      const secondaryAmount = !hasSupplierBrokerUnit && item.Commission_Cost__c != null
        ? Number(item.Commission_Cost__c || 0) - buyerPerUnitAmount
        : 0;
      const secondaryBrokers = (buyerBrokersByStem[item.STEM__c] || []).filter(broker => {
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
            paymentDate: stem.Buyer_Pay_Term_Date__c,
            paymentDateLabel: 'Received Date',
            paymentStatus: buyerStatusByStemBroker[`${item.STEM__c}:${broker.Buyer_Broker__c}`] || 'Pending',
          });
        }
      }

    }

    rows.sort((a, b) => String(b.deliveryDate || '').localeCompare(String(a.deliveryDate || '')));
    return Response.json({ rows });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});