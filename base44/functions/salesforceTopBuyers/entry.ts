import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { year = 2025, limit = 10 } = body;

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    const soql = `SELECT Buyer_Name__c, SUM(Total_Invoice_Amount__c) totalInvoice FROM stem__c WHERE Delivery_Date__c >= ${year}-01-01 AND Delivery_Date__c <= ${year}-12-31 AND Buyer_Name__c != null GROUP BY Buyer_Name__c ORDER BY SUM(Total_Invoice_Amount__c) DESC LIMIT ${limit}`;

    const encoded = encodeURIComponent(soql);
    const res = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/query/?q=${encoded}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    if (data.errorCode || (Array.isArray(data) && data[0]?.errorCode)) {
      throw new Error(data.message || (Array.isArray(data) && data[0]?.message) || 'Query error');
    }

    const buyers = (data.records || []).map(r => ({
      name: r.Buyer_Name__c,
      total: r.totalInvoice ?? 0,
    }));

    return Response.json({ buyers });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});