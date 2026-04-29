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
  // Paginate up to 2000 records
  let records = data.records || [];
  let nextUrl = data.nextRecordsUrl;
  while (nextUrl && records.length < 2000) {
    const nextRes = await fetch(`${SF_INSTANCE}${nextUrl}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const nextData = await nextRes.json();
    records = [...records, ...(nextData.records || [])];
    nextUrl = nextData.nextRecordsUrl;
  }
  return records;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { where, limit = 500 } = body;

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    const whereClause = where ? `WHERE ${where}` : '';

    // Step 1: fetch stems
    const stems = await sfQuery(accessToken, `
      SELECT Id, KeyStem__c, Name, Delivery_Date__c,
             Account__r.Name,
             Total_Invoice_Amount__c,
             Total_Invoiced_Amount_From_Suppliers__c
      FROM stem__c
      ${whereClause}
      ORDER BY Delivery_Date__c DESC
      LIMIT ${limit}
    `);

    if (!stems.length) {
      return Response.json({ rows: [], totals: { count: 0, complete: 0, Buyer_Invoice: 0, Supplier_Invoice: 0, Costs: 0, Total_Broker_Comm: 0, Gross_Profit: 0, Net_Profit: 0 } });
    }

    // Step 2: use stem IDs for line item queries (chunk into 200 for IN clause)
    const stemIds = stems.map(s => s.Id);
    const chunkIds = (ids, size = 200) => {
      const chunks = [];
      for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
      return chunks;
    };

    const idChunks = chunkIds(stemIds);

    const [lineItemArrays, buyerBrokerArrays, extraCostArrays] = await Promise.all([
      Promise.all(idChunks.map(chunk => {
        const inList = chunk.map(id => `'${id}'`).join(',');
        return sfQuery(accessToken, `
          SELECT Id, STEM__c, Quantity__c,
                 Buyers_Brokers_Commission_Lumpsum__c,
                 Suppliers_Brokers_Commission_Lumpsum__c,
                 Suppliers_Brokers_Commission_Per_Unit__c,
                 Supplier_Broker__r.Name
          FROM STEM_Line_Item__c
          WHERE STEM__c IN (${inList})
          LIMIT 2000
        `);
      })),
      Promise.all(idChunks.map(chunk => {
        const inList = chunk.map(id => `'${id}'`).join(',');
        return sfQuery(accessToken, `
          SELECT STEM_Line_Item__r.STEM__c, Commission_Lumpsum__c,
                 STEM_Line_Item__r.Quantity__c
          FROM STEM_Line_Item_Buyer_Broker__c
          WHERE STEM_Line_Item__r.STEM__c IN (${inList})
          LIMIT 5000
        `);
      })),
      Promise.all(idChunks.map(chunk => {
        const inList = chunk.map(id => `'${id}'`).join(',');
        return sfQuery(accessToken, `
          SELECT STEM__c, Line_Total_Buy__c
          FROM STEM_Extra_Cost__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `);
      })),
    ]);

    const lineItems = lineItemArrays.flat();
    const buyerBrokerItems = buyerBrokerArrays.flat();
    const extraCosts = extraCostArrays.flat();

    // Build per-stem extra cost totals (buy side)
    const extraCostByStemId = {};
    for (const ec of extraCosts) {
      const id = ec.STEM__c;
      if (!id) continue;
      extraCostByStemId[id] = (extraCostByStemId[id] ?? 0) + (ec.Line_Total_Buy__c ?? 0);
    }

    // Build per-stem aggregates from line items
    const byId = {};
    const initStem = (id) => {
      if (!byId[id]) byId[id] = {
        suppBrokerCommPerUnit: 0,
        suppBrokerLumpsumSet: false,
        suppBrokerLumpsum: 0,
        buyerBrokerLumpsum: 0,
        buyerBrokerLumpsumLineItem: 0,
        suppBrokerName: null,
      };
    };

    for (const li of lineItems) {
      const id = li.STEM__c;
      if (!id) continue;
      initStem(id);
      const qty = li.Quantity__c ?? 0;
      // Lumpsum is a stem-level value repeated on every line item — only take it once
      if (!byId[id].suppBrokerLumpsumSet && (li.Suppliers_Brokers_Commission_Lumpsum__c ?? 0) !== 0) {
        byId[id].suppBrokerLumpsum = li.Suppliers_Brokers_Commission_Lumpsum__c;
        byId[id].suppBrokerLumpsumSet = true;
      }
      byId[id].buyerBrokerLumpsumLineItem += (li.Buyers_Brokers_Commission_Lumpsum__c ?? 0);
      if (!byId[id].suppBrokerName && li['Supplier_Broker__r']?.Name) {
        byId[id].suppBrokerName = li['Supplier_Broker__r'].Name;
      }
    }

    for (const bb of buyerBrokerItems) {
      const id = bb['STEM_Line_Item__r']?.STEM__c;
      if (!id) continue;
      initStem(id);
      byId[id].buyerBrokerLumpsum += (bb.Commission_Lumpsum__c ?? 0);
    }

    // Build final rows
    const rows = stems.map(s => {
      const buyer = s.Total_Invoice_Amount__c ?? 0;
      const supplier = (s.Total_Invoiced_Amount_From_Suppliers__c ?? 0) + (extraCostByStemId[s.Id] ?? 0);
      const agg = byId[s.Id] || {};
      const suppBrokerComm = agg.suppBrokerLumpsum ?? 0;
      const buyerBrokerComm = (agg.buyerBrokerLumpsum ?? 0) + (agg.buyerBrokerLumpsumLineItem ?? 0);
      const totalBroker = suppBrokerComm + buyerBrokerComm;
      const grossProfit = buyer - supplier;
      const netProfit = grossProfit - totalBroker;
      const margin = buyer > 0 ? (netProfit / buyer) * 100 : null;

      return {
        Id: s.Id,
        Key: s.KeyStem__c,
        Name: s.Name,
        Delivery_Date: s.Delivery_Date__c,
        Buyer: s['Account__r']?.Name ?? null,
        Buyer_Invoice: buyer || null,
        Supplier_Invoice: supplier || null,
        Supplier_Broker_Comm: suppBrokerComm || null,
        Buyer_Broker_Comm: buyerBrokerComm || null,
        Total_Broker_Comm: totalBroker || null,
        Gross_Profit: (buyer && supplier) ? grossProfit : null,
        Net_Profit: (buyer && supplier) ? netProfit : null,
        Margin_Pct: (buyer && supplier) ? margin : null,
      };
    });

    // Summary totals (only stems with both buyer & supplier invoices)
    const complete = rows.filter(r => r.Buyer_Invoice && r.Supplier_Invoice);
    const totals = {
      count: rows.length,
      complete: complete.length,
      Buyer_Invoice: complete.reduce((s, r) => s + (r.Buyer_Invoice ?? 0), 0),
      Supplier_Invoice: complete.reduce((s, r) => s + (r.Supplier_Invoice ?? 0), 0),
      Total_Broker_Comm: complete.reduce((s, r) => s + (r.Total_Broker_Comm ?? 0), 0),
      Gross_Profit: complete.reduce((s, r) => s + (r.Gross_Profit ?? 0), 0),
      Net_Profit: complete.reduce((s, r) => s + (r.Net_Profit ?? 0), 0),
    };

    return Response.json({ rows, totals });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});