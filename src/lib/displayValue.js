const PREFERRED_NUMERIC_OBJECT_KEYS = [
  'Receivable_Balance__c',
];

const PREFERRED_OBJECT_KEYS = [
  'Name',
  'name',
  'Label',
  'label',
  'Title',
  'title',
  'DeveloperName',
  'FullName',
  'Email',
  'Username',
  'Id',
  'id',
];

export function textValue(value, fallback = '—') {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'object') return String(value);

  if (Array.isArray(value)) {
    const text = value.map((item) => textValue(item, '')).filter(Boolean).join(', ');
    return text || fallback;
  }

  if ('totalSize' in value && Array.isArray(value.records)) {
    const count = value.totalSize ?? value.records.length;
    return `${Number(count || 0).toLocaleString()} record${Number(count) === 1 ? '' : 's'}`;
  }

  for (const key of PREFERRED_NUMERIC_OBJECT_KEYS) {
    const number = numericValue(value[key]);
    if (number != null) {
      return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }

  for (const key of PREFERRED_OBJECT_KEYS) {
    if (value[key] != null && value[key] !== '') return String(value[key]);
  }

  const entry = Object.entries(value).find(([key, entryValue]) => (
    key !== 'attributes' &&
    entryValue != null &&
    entryValue !== '' &&
    typeof entryValue !== 'object'
  ));

  return entry ? String(entry[1]) : fallback;
}

export function compactTextValue(value, maxLength = 60, fallback = '—') {
  const text = textValue(value, fallback);
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

export function numericValue(value) {
  if (value == null || value === '' || typeof value === 'object') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
