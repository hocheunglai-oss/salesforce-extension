import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SF_INSTANCE = "https://fratellicosulich.my.salesforce.com";
const SF_API_VERSION = "v59.0";

const KEY_STANDARD = new Set(['Account', 'Contact', 'Opportunity', 'Lead', 'Case', 'Task', 'User', 'Product2', 'Pricebook2', 'Contract', 'Order']);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("salesforce");

    // Use the bulk describe endpoint — one single call for all objects
    const globalRes = await fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/describe/`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const globalData = await globalRes.json();

    const sobjects = (globalData.sobjects || []);

    // Filter to custom objects + key standard objects only
    const filtered = sobjects.filter(o => o.queryable && (o.custom || KEY_STANDARD.has(o.name)));

    // The global describe gives us name, label, custom but NOT fields.
    // However it's much faster than individual describes.
    // For fields, only describe the custom objects + key standard (much smaller set) in parallel — all at once, no batching.
    const described = await Promise.all(
      filtered.map(o =>
        fetch(`${SF_INSTANCE}/services/data/${SF_API_VERSION}/sobjects/${o.name}/describe/`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
          .then(r => r.json())
          .then(d => ({
            name: d.name,
            label: d.label,
            custom: d.custom,
            fields: (d.fields || [])
              .filter(f => !['IsDeleted', 'SystemModstamp', 'LastReferencedDate', 'LastViewedDate', 'LastActivityDate'].includes(f.name))
              .map(f => ({
                name: f.name,
                label: f.label,
                type: f.type,
                referenceTo: f.referenceTo || [],
                relationshipName: f.relationshipName || null,
              })),
          }))
          .catch(() => null)
      )
    );

    const valid = described.filter(Boolean);

    // Build relationship edges
    const objectNames = new Set(valid.map(o => o.name));
    const edges = [];
    valid.forEach(obj => {
      obj.fields.forEach(f => {
        if (f.type === 'reference') {
          f.referenceTo.forEach(target => {
            if (objectNames.has(target) && target !== obj.name) {
              edges.push({ from: obj.name, to: target, field: f.name, label: f.label });
            }
          });
        }
      });
    });

    return Response.json({ objects: valid, edges });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});