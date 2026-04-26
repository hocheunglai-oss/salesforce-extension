import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { objectName } = body;

    if (!objectName) return Response.json({ error: 'objectName required' }, { status: 400 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    const res = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/${objectName}/describe/`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    const fields = (data.fields || []).map(f => ({
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

    return Response.json({ objectName, label: data.label, fields });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});