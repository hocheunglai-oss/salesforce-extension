export const MONTHS = [
  { value: 1, label: 'Jan' }, { value: 2, label: 'Feb' }, { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' }, { value: 5, label: 'May' }, { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' }, { value: 8, label: 'Aug' }, { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' }, { value: 11, label: 'Nov' }, { value: 12, label: 'Dec' },
];

const now = new Date();

export const THIS_YEAR = now.getFullYear();
export const THIS_MONTH = now.getMonth() + 1;

export const getRecentYears = (baseYear = THIS_YEAR, count = 3) =>
  Array.from({ length: count }, (_, index) => baseYear - index);

export function buildEffectiveDateRange(startDate, endDate) {
  return `((Delivery_Date__c >= ${startDate} AND Delivery_Date__c <= ${endDate}) OR (Delivery_Date__c = null AND Expected_Delivery_Date__c >= ${startDate} AND Expected_Delivery_Date__c <= ${endDate}))`;
}

export function buildDeliveryWhere(years, months) {
  if (!years.length) return '';
  const conditions = [];
  for (const yr of years) {
    if (!months.length || months.length === 12) {
      conditions.push(buildEffectiveDateRange(`${yr}-01-01`, `${yr}-12-31`));
    } else {
      for (const mo of months) {
        const mm = String(mo).padStart(2, '0');
        const lastDay = new Date(Number(yr), Number(mo), 0).getDate();
        conditions.push(buildEffectiveDateRange(`${yr}-${mm}-01`, `${yr}-${mm}-${lastDay}`));
      }
    }
  }
  return conditions.join(' OR ');
}

export function formatSelectedMonths(selectedMonths) {
  if (selectedMonths.length === 12) return 'All months';
  return selectedMonths
    .slice()
    .sort((a, b) => Number(a) - Number(b))
    .map(month => MONTHS.find(item => item.value === Number(month))?.label)
    .filter(Boolean)
    .join(', ');
}
