export function grossMarginPercent(grossProfit, turnover) {
  const profit = Number(grossProfit);
  const revenue = Number(turnover);
  if (!Number.isFinite(profit) || !Number.isFinite(revenue) || revenue === 0) return null;
  return (profit / revenue) * 100;
}
