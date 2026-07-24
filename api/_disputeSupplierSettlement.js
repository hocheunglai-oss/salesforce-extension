const MONEY_TOLERANCE = 0.01;

function money(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : fallback;
}

function text(value) {
  return String(value || '').trim();
}

function compareText(left, right) {
  return text(left).localeCompare(text(right));
}

const SALESFORCE_MONEY_TYPES = new Set(['currency', 'double', 'int', 'long']);
const SALESFORCE_DATE_TYPES = new Set(['date', 'datetime']);

function firstTypedField(fieldByName, candidates, allowedTypes) {
  return candidates.find((name) => {
    const field = fieldByName[name];
    return field && allowedTypes.has(field.type);
  }) || null;
}

export function resolveSupplierSettlementSchema({
  supplierInvoiceFields = [],
  paymentFields = [],
} = {}) {
  const invoiceFieldNames = new Set(supplierInvoiceFields.map((field) => field?.name).filter(Boolean));
  const paymentFieldNames = new Set(paymentFields.map((field) => field?.name).filter(Boolean));
  const invoiceFieldByName = Object.fromEntries(supplierInvoiceFields.map((field) => [field?.name, field]));
  const paymentFieldByName = Object.fromEntries(paymentFields.map((field) => [field?.name, field]));
  const invoiceAmountCandidates = ['Invoice_Amount__c', 'Calculated_Amount__c', 'Amount__c', 'Total_Amount__c'];
  const invoicePayableCandidates = ['Payable_Balance__c', 'Balance__c', 'Actual_Balance__c', 'Outstanding_Balance__c'];
  const paymentAmountCandidates = [
    'Amount__c',
    'Payment_Amount__c',
    'Paid_Amount__c',
    'Received_Amount__c',
    'Total_Amount__c',
    'Amount_Paid__c',
    'Payment_Value__c',
    'Actual_Amount__c',
  ];
  const invoiceAmountField = firstTypedField(invoiceFieldByName, invoiceAmountCandidates, SALESFORCE_MONEY_TYPES);
  const invoicePayableField = firstTypedField(invoiceFieldByName, invoicePayableCandidates, SALESFORCE_MONEY_TYPES);
  const invoiceDueDateFields = ['Invoice_Due_Date__c', 'Due_Date__c', 'Payment_Due_Date__c', 'Pay_Term_Date__c', 'Supplier_Pay_Term_Date__c']
    .filter((name) => SALESFORCE_DATE_TYPES.has(invoiceFieldByName[name]?.type));
  const invoiceDateFields = ['Date__c', 'Invoice_Date__c', 'Issued_Date__c', 'CreatedDate']
    .filter((name) => SALESFORCE_DATE_TYPES.has(invoiceFieldByName[name]?.type));
  const invoiceStatusFields = ['Status__c', 'Invoice_Status__c', 'Payment_Status__c']
    .filter((name) => invoiceFieldNames.has(name));
  const supplierAccountFields = ['Supplier__c', 'Expected_Supplier__c', 'Substitute_Supplier__c']
    .filter((name) => {
      const field = invoiceFieldByName[name];
      return field?.type === 'reference' && Array.isArray(field.referenceTo) && field.referenceTo.includes('Account');
    });
  const paymentAmountField = firstTypedField(paymentFieldByName, paymentAmountCandidates, SALESFORCE_MONEY_TYPES);
  const paymentDateField = firstTypedField(
    paymentFieldByName,
    ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate'],
    SALESFORCE_DATE_TYPES,
  );
  const paymentSupplierInvoiceFields = paymentFields
    .filter((field) => field?.type === 'reference' && Array.isArray(field.referenceTo) && field.referenceTo.includes('Supplier_Invoice__c'))
    .map((field) => field.name);
  const paymentStatusFields = ['Status__c', 'Payment_Status__c'].filter((name) => paymentFieldNames.has(name));
  const issues = [
    invoiceAmountField ? null : 'Supplier_Invoice__c requires a numeric invoice amount field.',
    invoicePayableField ? null : 'Supplier_Invoice__c requires a numeric payable balance field.',
    supplierAccountFields.length ? null : 'Supplier_Invoice__c requires a supplier Lookup(Account).',
    paymentAmountField ? null : 'Payment__c requires a numeric amount field.',
    paymentDateField ? null : 'Payment__c requires a date or datetime payment date field.',
    paymentSupplierInvoiceFields.length ? null : 'Payment__c requires a Lookup(Supplier_Invoice__c).',
  ].filter(Boolean);
  return {
    valid: issues.length === 0,
    issues,
    invoiceAmountField,
    invoicePayableField,
    invoiceDueDateFields,
    invoiceDateFields,
    invoiceStatusFields,
    supplierAccountFields,
    paymentAmountField,
    paymentDateField,
    paymentSupplierInvoiceFields,
    paymentStatusFields,
  };
}

export function validSupplierSettlementPayment(payment = {}, statusFields = []) {
  const status = statusFields.map((field) => payment?.[field]).find(Boolean);
  const token = text(status).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return !['cancelled', 'canceled', 'void', 'voided', 'rejected', 'deleted'].some((value) => token.includes(value));
}

export function supplierInvoicePaymentState(invoice = {}) {
  const invoiceAmount = Math.max(0, money(invoice.invoiceAmount, 0));
  const rawPayableBalance = money(invoice.payableBalance, 0);
  const payableBalance = Math.max(0, rawPayableBalance);
  const paidAmount = Math.max(0, invoiceAmount - payableBalance);
  if (rawPayableBalance < -MONEY_TOLERANCE) return 'Overpaid';
  if (invoiceAmount <= MONEY_TOLERANCE) return 'Amount unavailable';
  if (payableBalance <= MONEY_TOLERANCE) return 'Paid';
  if (paidAmount <= MONEY_TOLERANCE) return 'Unpaid';
  return 'Partly paid';
}

export function normalizeSupplierInvoiceExposure(invoice = {}) {
  const invoiceAmount = Math.max(0, money(invoice.invoiceAmount, 0));
  const rawPayableBalance = money(invoice.payableBalance, 0);
  const payableBalance = Math.max(0, Math.min(rawPayableBalance, invoiceAmount));
  const warnings = [];
  if (rawPayableBalance < -MONEY_TOLERANCE) {
    warnings.push('Supplier invoice payable balance is negative.');
  }
  if (rawPayableBalance > invoiceAmount + MONEY_TOLERANCE) {
    warnings.push('Supplier invoice payable balance exceeds its invoice amount.');
  }
  return {
    ...invoice,
    supplierInvoiceId: text(invoice.supplierInvoiceId || invoice.id),
    invoiceName: text(invoice.invoiceName || invoice.name),
    supplierAccountId: text(invoice.supplierAccountId),
    supplierName: text(invoice.supplierName),
    currencyIsoCode: text(invoice.currencyIsoCode || invoice.currency || 'USD') || 'USD',
    dueDate: text(invoice.dueDate) || null,
    invoiceDate: text(invoice.invoiceDate) || null,
    createdDate: text(invoice.createdDate) || null,
    invoiceAmount,
    rawPayableBalance,
    payableBalance,
    paidAmount: Math.max(0, invoiceAmount - payableBalance),
    paymentState: supplierInvoicePaymentState({ invoiceAmount, payableBalance: rawPayableBalance }),
    warnings: [...new Set([...(invoice.warnings || []), ...warnings])],
  };
}

export function sortSupplierInvoicesOldestFirst(invoices = []) {
  return invoices
    .map(normalizeSupplierInvoiceExposure)
    .sort((left, right) => (
      compareText(left.dueDate || '9999-12-31', right.dueDate || '9999-12-31')
      || compareText(left.invoiceDate || left.createdDate || '9999-12-31', right.invoiceDate || right.createdDate || '9999-12-31')
      || compareText(left.supplierInvoiceId, right.supplierInvoiceId)
    ));
}

function allocationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizedOverrides(invoiceAllocations = []) {
  const amounts = new Map();
  for (const allocation of invoiceAllocations || []) {
    const supplierInvoiceId = text(allocation?.supplierInvoiceId || allocation?.sourceSupplierInvoiceId);
    if (!supplierInvoiceId) throw allocationError('Every invoice allocation requires a supplier invoice.', 'invoice_allocation_id_required');
    if (amounts.has(supplierInvoiceId)) throw allocationError('A supplier invoice may appear only once in the allocation.', 'duplicate_invoice_allocation');
    const amount = money(allocation?.amount ?? allocation?.allocatedAmount);
    if (amount == null || amount < 0) throw allocationError('Invoice allocation amounts must be zero or greater.', 'invalid_invoice_allocation_amount');
    amounts.set(supplierInvoiceId, amount);
  }
  return amounts;
}

export function allocateSupplierDispute({
  invoices = [],
  disputeAmount,
  currencyIsoCode = 'USD',
  invoiceAllocations = [],
} = {}) {
  const amount = money(disputeAmount);
  if (amount == null || amount < 0) {
    throw allocationError('Supplier dispute amount must be zero or greater.', 'invalid_supplier_dispute_amount');
  }

  const currency = text(currencyIsoCode || 'USD') || 'USD';
  const sortedInvoices = sortSupplierInvoicesOldestFirst(invoices)
    .filter((invoice) => invoice.currencyIsoCode === currency);
  const invoiceById = new Map(sortedInvoices.map((invoice) => [invoice.supplierInvoiceId, invoice]));
  const overrides = normalizedOverrides(invoiceAllocations);
  for (const supplierInvoiceId of overrides.keys()) {
    if (!invoiceById.has(supplierInvoiceId)) {
      throw allocationError('An invoice allocation references an unavailable supplier invoice.', 'forged_supplier_invoice_allocation');
    }
  }

  const allocationAmounts = new Map();
  let allocated = 0;
  for (const [supplierInvoiceId, overrideAmount] of overrides) {
    const invoice = invoiceById.get(supplierInvoiceId);
    if (overrideAmount > invoice.invoiceAmount + MONEY_TOLERANCE) {
      throw allocationError('An invoice allocation cannot exceed the supplier invoice amount.', 'invoice_allocation_exceeds_invoice');
    }
    allocationAmounts.set(supplierInvoiceId, overrideAmount);
    allocated += overrideAmount;
  }
  if (allocated > amount + MONEY_TOLERANCE) {
    throw allocationError('Invoice allocations cannot exceed the supplier dispute amount.', 'invoice_allocations_exceed_dispute');
  }

  let remaining = Math.max(0, amount - allocated);
  for (const invoice of sortedInvoices) {
    if (allocationAmounts.has(invoice.supplierInvoiceId) || remaining <= MONEY_TOLERANCE) continue;
    const invoiceAllocation = Math.min(invoice.invoiceAmount, remaining);
    allocationAmounts.set(invoice.supplierInvoiceId, invoiceAllocation);
    remaining = Math.max(0, remaining - invoiceAllocation);
  }
  if (remaining > MONEY_TOLERANCE) {
    throw allocationError(
      sortedInvoices.length
        ? 'Supplier dispute amount exceeds the available supplier invoices.'
        : 'No supplier invoices are available for this supplier and currency.',
      'supplier_dispute_exceeds_invoices',
    );
  }

  const allocations = sortedInvoices
    .filter((invoice) => allocationAmounts.has(invoice.supplierInvoiceId))
    .map((invoice) => {
      const allocatedAmount = money(allocationAmounts.get(invoice.supplierInvoiceId), 0);
      const doNotPayAmount = Math.min(allocatedAmount, invoice.payableBalance);
      const getBackPaidAmount = Math.max(0, allocatedAmount - doNotPayAmount);
      return {
        supplierInvoiceId: invoice.supplierInvoiceId,
        invoiceName: invoice.invoiceName,
        supplierAccountId: invoice.supplierAccountId,
        supplierName: invoice.supplierName,
        currencyIsoCode: invoice.currencyIsoCode,
        dueDate: invoice.dueDate,
        invoiceDate: invoice.invoiceDate,
        createdDate: invoice.createdDate,
        invoiceAmount: invoice.invoiceAmount,
        payableBalance: invoice.payableBalance,
        paidAmount: invoice.paidAmount,
        paymentState: invoice.paymentState,
        status: invoice.status || null,
        payments: Array.isArray(invoice.payments) ? invoice.payments : [],
        netPaymentAudit: money(invoice.netPaymentAudit, 0),
        allocatedAmount,
        doNotPayAmount: money(doNotPayAmount, 0),
        getBackPaidAmount: money(getBackPaidAmount, 0),
        warnings: invoice.warnings,
      };
    });

  const totalDoNotPay = money(allocations.reduce((sum, item) => sum + item.doNotPayAmount, 0), 0);
  const totalGetBackPaid = money(allocations.reduce((sum, item) => sum + item.getBackPaidAmount, 0), 0);
  return {
    disputeAmount: amount,
    currencyIsoCode: currency,
    totalDoNotPay,
    totalGetBackPaid,
    allocations,
    fingerprint: supplierAllocationFingerprint({ disputeAmount: amount, currencyIsoCode: currency, allocations }),
  };
}

export function supplierAllocationFingerprint(allocation = {}) {
  return JSON.stringify({
    disputeAmount: money(allocation.disputeAmount, 0),
    currencyIsoCode: text(allocation.currencyIsoCode || 'USD') || 'USD',
    allocations: (allocation.allocations || []).map((item) => ({
      supplierInvoiceId: text(item.supplierInvoiceId),
      invoiceAmount: money(item.invoiceAmount, 0),
      payableBalance: money(item.payableBalance, 0),
      allocatedAmount: money(item.allocatedAmount, 0),
      doNotPayAmount: money(item.doNotPayAmount, 0),
      getBackPaidAmount: money(item.getBackPaidAmount, 0),
    })),
  });
}

export function supplierInstructionRows(allocation = {}) {
  const rows = [];
  for (const item of allocation.allocations || []) {
    const common = {
      source_supplier_invoice_id: item.supplierInvoiceId,
      source_supplier_invoice_name: item.invoiceName || null,
      currency_iso_code: item.currencyIsoCode || allocation.currencyIsoCode || 'USD',
      source_invoice_amount_snapshot: item.invoiceAmount,
      source_payable_balance_snapshot: item.payableBalance,
      source_paid_amount_snapshot: item.paidAmount,
      source_invoice_snapshot: {
        supplierInvoiceId: item.supplierInvoiceId,
        invoiceName: item.invoiceName,
        supplierAccountId: item.supplierAccountId,
        supplierName: item.supplierName,
        currencyIsoCode: item.currencyIsoCode,
        dueDate: item.dueDate,
        invoiceDate: item.invoiceDate,
        createdDate: item.createdDate,
        invoiceAmount: item.invoiceAmount,
        payableBalance: item.payableBalance,
        paidAmount: item.paidAmount,
        paymentState: item.paymentState,
        status: item.status,
        warnings: item.warnings,
      },
      payment_snapshot: {
        payments: item.payments,
        netPaymentAudit: item.netPaymentAudit,
      },
      allocated_amount: item.allocatedAmount,
      allocation_fingerprint: allocation.fingerprint,
    };
    if (item.doNotPayAmount > MONEY_TOLERANCE) {
      rows.push({
        ...common,
        instruction_type: 'withhold_unpaid',
        planned_amount: item.doNotPayAmount,
        status: 'Provisional Hold',
      });
    }
    if (item.getBackPaidAmount > MONEY_TOLERANCE) {
      rows.push({
        ...common,
        instruction_type: 'get_back_paid',
        planned_amount: item.getBackPaidAmount,
        status: 'Pending Accounting',
      });
    }
  }
  return rows;
}
