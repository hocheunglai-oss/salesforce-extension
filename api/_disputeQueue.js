const HIDDEN_EXTRA_COST_PRODUCT_RE = /(transport|undercharge|adjustment)/i;

export function disputeQueueExtraCostProductName(item = {}) {
  const productName = String(item?.Product2Id__r?.Name || item?.Product__r?.Name || '').trim();
  if (!productName || HIDDEN_EXTRA_COST_PRODUCT_RE.test(productName)) return '';
  return productName;
}
