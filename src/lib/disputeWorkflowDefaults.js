export const FULL_PAYMENT_RECEIVED_REASON = 'Full payment received from buyer';
export const NO_BALANCE_PAYMENT_INSTRUCTION = 'No Balance Payment';

function isExplicitZero(value) {
  if (value == null || value === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) < 0.005;
}

export function disputeClosureDefaults({
  actionType,
  buyerReceivableBalance,
  supplierPayableBalance,
} = {}) {
  const isBuyerOrSupplierClosure = actionType === 'close_buyer_dispute'
    || actionType === 'close_supplier_dispute';

  return {
    closeReason: isBuyerOrSupplierClosure && isExplicitZero(buyerReceivableBalance)
      ? FULL_PAYMENT_RECEIVED_REASON
      : '',
    balancePaymentInstruction: actionType === 'close_supplier_dispute'
      && isExplicitZero(supplierPayableBalance)
      ? NO_BALANCE_PAYMENT_INSTRUCTION
      : '',
  };
}
