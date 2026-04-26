import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

async function sfGet(accessToken, path) {
  const res = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return res.json();
}

async function sfQuery(accessToken, soql) {
  const encoded = encodeURIComponent(soql);
  const res = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/query/?q=${encoded}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (data.errorCode || (Array.isArray(data) && data[0]?.errorCode)) {
    return [];
  }
  return (data.records || []).map(({ attributes, ...rest }) => rest);
}

async function resolveViaQuery(accessToken, objectType, id, nameField = 'Name') {
  if (!id) return null;
  try {
    const encoded = encodeURIComponent(`SELECT ${nameField} FROM ${objectType} WHERE Id = '${id}' LIMIT 1`);
    const res = await sfGet(accessToken, `/query/?q=${encoded}`);
    return res.records?.[0]?.[nameField] ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { stemId, updates } = body;

    if (!stemId) return Response.json({ error: 'stemId required' }, { status: 400 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    // If stemId looks like KeyStem__c (not a 15/18 char SF ID), look it up first
    let actualStemId = stemId;
    if (stemId.length < 15) {
      const lookup = await sfQuery(accessToken, `SELECT Id FROM stem__c WHERE KeyStem__c = '${stemId}' LIMIT 1`);
      if (lookup.length === 0) {
        return Response.json({ error: `STEM with KeyStem__c '${stemId}' not found` }, { status: 404 });
      }
      actualStemId = lookup[0].Id;
    }

    // If updates provided, PATCH the record
    if (updates && Object.keys(updates).length > 0) {
      const patchRes = await fetch(
        `${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/stem__c/${actualStemId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updates),
        }
      );
      if (!patchRes.ok) {
        const err = await patchRes.json();
        return Response.json({ error: err[0]?.message || 'Update failed' }, { status: 400 });
      }
    }

    // Fetch full record + child records in parallel
    const [res, lineItems, extraCosts, buyerBrokers] = await Promise.all([
      sfGet(accessToken, `/sobjects/stem__c/${actualStemId}`),
      sfQuery(accessToken, `SELECT Id, Name__c, Supplier_Name__c, Quantity__c, Quantity_Max__c, Price_Per_Unit__c, Total_Price__c, Cost_Per_Unit__c, Total_Cost__c, Payment_Term__c, BDN_Number__c, Quantity_in_MT__c, Is_Quantity_Range__c, Buyers_Brokers_Commission_Per_Unit__c, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Suppliers_Brokers_Commission_Lumpsum__c FROM STEM_Line_Item__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`),
      sfQuery(accessToken, `SELECT Id, Name, Description__c, Supplier_Name__c, Quantity__c, Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c, Type__c, Payment_Term__c FROM STEM_Extra_Cost__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`),
      sfQuery(accessToken, `SELECT Id, Buyer_Broker__c, Refcode_Index__c, Exported__c FROM STEM_Buyer_Broker__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`),
    ]);

    if (res.errorCode) {
      return Response.json({ error: res.message }, { status: 404 });
    }

    delete res.attributes;

    // Resolve related IDs to names in parallel
    const [vesselName, portName, agentName, accountName, buyerBrokerName, factoringInvoiceName] = await Promise.all([
      res.Vessel__c ? resolveViaQuery(accessToken, 'Vessel__c', res.Vessel__c, 'Name') : Promise.resolve(null),
      res.Port__c ? resolveViaQuery(accessToken, 'Port__c', res.Port__c, 'Name') : Promise.resolve(null),
      res.Agent__c ? resolveViaQuery(accessToken, 'Account', res.Agent__c, 'Name') : Promise.resolve(null),
      res.Account__c ? resolveViaQuery(accessToken, 'Account', res.Account__c, 'Name') : Promise.resolve(null),
      res.Buyer_Broker__c ? resolveViaQuery(accessToken, 'Account', res.Buyer_Broker__c, 'Name') : Promise.resolve(null),
      res.Factoring_Invoice__c ? resolveViaQuery(accessToken, 'Invoice__c', res.Factoring_Invoice__c, 'Name') : Promise.resolve(null),
    ]);

    // Resolve buyer broker names for child STEM_Buyer_Broker__c records
    const buyerBrokersWithNames = await Promise.all(
      buyerBrokers.map(async (bb) => {
        const brokerName = bb.Buyer_Broker__c
          ? await resolveViaQuery(accessToken, 'Account', bb.Buyer_Broker__c, 'Name')
          : null;
        return { ...bb, _Buyer_Broker_Name: brokerName };
      })
    );

    // Resolve supplier broker names from line items
    const uniqueSupplierBrokerIds = [...new Set(lineItems.map(li => li.Supplier_Broker__c).filter(Boolean))];
    const supplierBrokerNameMap = {};
    await Promise.all(
      uniqueSupplierBrokerIds.map(async (id) => {
        const name = await resolveViaQuery(accessToken, 'Account', id, 'Name');
        supplierBrokerNameMap[id] = name;
      })
    );
    const lineItemsWithBrokerNames = lineItems.map(li => ({
      ...li,
      _Supplier_Broker_Name: li.Supplier_Broker__c ? supplierBrokerNameMap[li.Supplier_Broker__c] : null,
    }));

    const record = {
      ...res,
      _Vessel_Name: vesselName,
      _Port_Name: portName,
      _Agent_Name: agentName,
      _Account_Name: accountName,
      _Buyer_Broker_Name: buyerBrokerName,
      _Factoring_Invoice_Name: factoringInvoiceName,
    };

    return Response.json({ record, lineItems: lineItemsWithBrokerNames, extraCosts, buyerBrokers: buyerBrokersWithNames });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});