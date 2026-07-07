import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { endOfQuarter, format, startOfQuarter, subQuarters } from 'date-fns';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import BrokerFilters from '@/components/brokers/BrokerFilters';
import BrokerRegisterTable from '@/components/brokers/BrokerRegisterTable';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import PageHeader from '@/components/common/PageHeader';
import TableShell from '@/components/common/TableShell';
import StateBlock from '@/components/common/StateBlock';
import { numericValue, textValue } from '@/lib/displayValue';
import { readExchangeRateSettings } from '@/lib/exchangeRateSettings';

const fmtMoney = (value) => {
  const number = numericValue(value);
  return `$${Number(number || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtDate = (value) => {
  if (!value) return '';
  if (typeof value === 'object') return textValue(value, '');
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return textValue(value, ''); }
};
const fmtUnit = (value) => {
  if (typeof value === 'string') return value;
  const number = numericValue(value);
  return number != null ? `${fmtMoney(number)} / MT` : textValue(value, '');
};
const fmtDelay = (value) => {
  const number = numericValue(value);
  return number != null ? `${number.toLocaleString()} day${Math.abs(number) === 1 ? '' : 's'}` : '';
};
const escapeHtml = (value) => textValue(value, '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');
const escapeXmlText = (value) => escapeHtml(value).replace(/\r?\n/g, '&#10;');
const ISO_FORMAT = 'yyyy-MM-dd';
const payableAmount = (row) => {
  const amount = Number(row.commissionAmount || 0);
  return amount > 0 ? amount : null;
};
const receivableAmount = (row) => {
  const amount = Number(row.commissionAmount || 0);
  return amount < 0 ? Math.abs(amount) : null;
};
const isoDate = (date) => format(date, ISO_FORMAT);
const previousQuarterRange = () => {
  const previousQuarter = subQuarters(new Date(), 1);
  return {
    from: isoDate(startOfQuarter(previousQuarter)),
    to: isoDate(endOfQuarter(previousQuarter)),
  };
};
const parseIsoDate = (value) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};
const latestRowDate = (rows) => rows
  .map((row) => row.paymentDateSort || row.paymentDate || row.deliveryDate)
  .filter(Boolean)
  .sort()
  .at(-1);
const lastWorkingDayOfQuarter = (basisDate) => {
  const parsed = parseIsoDate(basisDate) || new Date();
  const date = endOfQuarter(parsed);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() - 1);
  return isoDate(date);
};
const bankBuyRateFrom = (exchangeRate) => {
  const exchangeRateValue = numericValue(exchangeRate?.rate);
  return exchangeRateValue != null ? exchangeRateValue * 0.998 : null;
};
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
const textToBase64 = (value) => {
  const bytes = new TextEncoder().encode(value);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};
const roundCurrency = (value) => {
  const number = numericValue(value);
  return number == null ? null : Math.round((number + Number.EPSILON) * 100) / 100;
};
const spreadsheetText = (value) => textValue(value, '').replace(/; /g, '\n');
const widestLineLength = (value) => spreadsheetText(value).split(/\r?\n/).reduce((max, line) => Math.max(max, line.length), 0);
const columnWidth = (values, min = 70, max = 260) => {
  const maxLength = values.reduce((width, value) => Math.max(width, widestLineLength(value)), 0);
  return Math.min(max, Math.max(min, Math.round(maxLength * 6.8 + 18)));
};
const quarterLabel = (dateValue) => {
  const date = parseIsoDate(dateValue) || new Date();
  const year = date.getFullYear();
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${year}_Q${quarter}`;
};
const cleanBrokerFilePart = (value) => {
  const cleaned = textValue(value, '')
    .replace(/^\*+\s*/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return cleaned || 'BROKER';
};
const brokerTypeLabel = (value) => value === 'Secondary Buyer Broker' ? 'Buyer Broker' : textValue(value, '');
const brokerNameValue = (row) => textValue(row?.brokerName, '');
const stemNameValue = (row) => textValue(row?.stemName, '');
const sortText = (value) => textValue(value, '').toLocaleLowerCase();
const compareText = (a, b) => sortText(a).localeCompare(sortText(b), undefined, { numeric: true, sensitivity: 'base' });
const compareDateDesc = (a, b) => {
  const left = textValue(a, '');
  const right = textValue(b, '');
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return right.localeCompare(left);
};
const brokerSortCriteria = (brokerCount) => brokerCount > 1
  ? ['brokerName', 'stemName', 'deliveryDate', 'brokerType']
  : ['stemName', 'brokerName', 'deliveryDate', 'brokerType'];
const brokerSortPriority = (criteria) => Object.fromEntries(criteria.map((key, index) => [key, index + 1]));
const compareBrokerRows = (criteria) => (a, b) => {
  for (const key of criteria) {
    let result = 0;
    if (key === 'brokerName') result = compareText(a.brokerName, b.brokerName);
    if (key === 'stemName') result = compareText(a.stemName, b.stemName);
    if (key === 'deliveryDate') result = compareDateDesc(a.deliveryDate, b.deliveryDate);
    if (key === 'brokerType') result = compareText(brokerTypeLabel(a.brokerType), brokerTypeLabel(b.brokerType));
    if (result !== 0) return result;
  }
  return compareText(a.id, b.id);
};
const matchesBrokerType = (row, selectedTypes) => {
  if (!selectedTypes.length) return true;
  return selectedTypes.includes(row.brokerType) || selectedTypes.includes(brokerTypeLabel(row.brokerType));
};
const rowIdValue = (row) => textValue(row?.id, '');

export default function BrokerRegister() {
  const { toast } = useToast();
  const [initialDateRange] = useState(() => previousQuarterRange());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedBrokerNames, setSelectedBrokerNames] = useState([]);
  const [selectedHiddenBrokerFlags, setSelectedHiddenBrokerFlags] = useState([]);
  const [fromDate, setFromDate] = useState(() => initialDateRange.from);
  const [toDate, setToDate] = useState(() => initialDateRange.to);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [exchangeRateProvider] = useState(() => readExchangeRateSettings().provider);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [exchangeRateLoading, setExchangeRateLoading] = useState(false);
  const [exchangeRateError, setExchangeRateError] = useState(null);
  const [showCny, setShowCny] = useState(false);
  const [excludedRowIds, setExcludedRowIds] = useState([]);
  const [archivingExport, setArchivingExport] = useState(false);

  const loadRows = async (options = {}) => {
    setLoading(true);
    setError(null);
    const res = await appClient.functions.invoke('salesforceBrokerRegister', { limit: 2000 }, { cache: true, force: options.force });
    if (res.data?.error) setError(res.data.error);
    setRows(res.data?.rows || []);
    setLoading(false);
  };

  useEffect(() => { loadRows(); }, []);
  useEffect(() => {
    const validRowIds = new Set(rows.map(rowIdValue).filter(Boolean));
    setExcludedRowIds((current) => current.filter((id) => validRowIds.has(id)));
  }, [rows]);

  const brokerNames = useMemo(() => {
    const visibleRows = rows.filter(row => {
      const typeMatch = matchesBrokerType(row, selectedTypes);
      const hiddenBrokerMatch = !selectedHiddenBrokerFlags.length || selectedHiddenBrokerFlags.some(flag => flag === 'individual' ? row.hiddenBrokerIndividual : row.hiddenBrokerCompany);
      const date = row.paymentDateSort || row.paymentDate || '';
      const fromMatch = !fromDate || date >= fromDate;
      const toMatch = !toDate || date <= toDate;
      return typeMatch && hiddenBrokerMatch && fromMatch && toMatch;
    });
    return [...new Set(visibleRows.map(row => textValue(row.brokerName, '')).filter(Boolean))].sort();
  }, [rows, selectedTypes, selectedHiddenBrokerFlags, fromDate, toDate]);

  const filteredRows = useMemo(() => rows.filter(row => {
    const q = search.trim().toLowerCase();
    const textMatch = !q || [row.stemName, row.brokerName, row.productQuantityLabel]
      .some(value => textValue(value, '').toLowerCase().includes(q));
    const typeMatch = matchesBrokerType(row, selectedTypes);
    const brokerMatch = !selectedBrokerNames.length || selectedBrokerNames.includes(textValue(row.brokerName, ''));
    const hiddenBrokerMatch = !selectedHiddenBrokerFlags.length || selectedHiddenBrokerFlags.some(flag => flag === 'individual' ? row.hiddenBrokerIndividual : row.hiddenBrokerCompany);
    const date = row.paymentDateSort || row.paymentDate || '';
    const fromMatch = !fromDate || date >= fromDate;
    const toMatch = !toDate || date <= toDate;
    return textMatch && typeMatch && brokerMatch && hiddenBrokerMatch && fromMatch && toMatch;
  }), [rows, search, selectedTypes, selectedBrokerNames, selectedHiddenBrokerFlags, fromDate, toDate]);

  const visibleBrokerCount = useMemo(() => new Set(filteredRows.map(brokerNameValue).filter(Boolean)).size, [filteredRows]);
  const sortCriteria = useMemo(() => brokerSortCriteria(visibleBrokerCount), [visibleBrokerCount]);
  const sortPriority = useMemo(() => brokerSortPriority(sortCriteria), [sortCriteria]);
  const sortedRows = useMemo(() => [...filteredRows].sort(compareBrokerRows(sortCriteria)), [filteredRows, sortCriteria]);
  const excludedRowIdSet = useMemo(() => new Set(excludedRowIds), [excludedRowIds]);
  const includedSortedRows = useMemo(() => sortedRows.filter((row) => !excludedRowIdSet.has(rowIdValue(row))), [sortedRows, excludedRowIdSet]);
  const visibleExcludedCount = sortedRows.length - includedSortedRows.length;
  const toggleRowExcluded = (rowId) => {
    const id = textValue(rowId, '');
    if (!id) return;
    setExcludedRowIds((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ));
  };
  const clearVisibleExclusions = () => {
    const visibleIds = new Set(sortedRows.map(rowIdValue).filter(Boolean));
    setExcludedRowIds((current) => current.filter((id) => !visibleIds.has(id)));
  };

  const total = includedSortedRows.reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0);
  const exchangeRateTargetDate = useMemo(() => {
    const basisDate = toDate || fromDate || latestRowDate(includedSortedRows) || latestRowDate(sortedRows) || isoDate(new Date());
    return lastWorkingDayOfQuarter(basisDate);
  }, [includedSortedRows, sortedRows, fromDate, toDate]);

  const exportFileName = useMemo(() => {
    const basisDate = toDate || fromDate || latestRowDate(includedSortedRows) || latestRowDate(sortedRows) || isoDate(new Date());
    const selectedCleanNames = selectedBrokerNames.map(cleanBrokerFilePart).filter(Boolean);
    const filteredCleanNames = [...new Set(includedSortedRows.map(row => cleanBrokerFilePart(row.brokerName)).filter(Boolean))];
    const brokerName = selectedCleanNames.length === 1
      ? selectedCleanNames[0]
      : filteredCleanNames.length === 1
        ? filteredCleanNames[0]
        : selectedCleanNames.length > 1
          ? 'MULTIPLE_BROKERS'
          : 'ALL_BROKERS';
    return `COMM_${quarterLabel(basisDate)}_${brokerName}.xls`;
  }, [includedSortedRows, sortedRows, fromDate, selectedBrokerNames, toDate]);

  useEffect(() => {
    if (!showCny) {
      setExchangeRateLoading(false);
      setExchangeRateError(null);
      return undefined;
    }
    let cancelled = false;
    const loadExchangeRate = async () => {
      setExchangeRateLoading(true);
      setExchangeRateError(null);
      const res = await appClient.functions.invoke('frankfurterUsdCnyRate', {
        date: exchangeRateTargetDate,
        provider: exchangeRateProvider,
      });
      if (cancelled) return;
      if (res.data?.error) {
        setExchangeRate(null);
        setExchangeRateError(res.data.error);
      } else {
        setExchangeRate(res.data);
      }
      setExchangeRateLoading(false);
    };
    loadExchangeRate();
    return () => { cancelled = true; };
  }, [exchangeRateProvider, exchangeRateTargetDate, showCny]);

  const commissionPayableTotal = includedSortedRows.reduce((sum, row) => sum + Number(payableAmount(row) || 0), 0);
  const commissionReceivableTotal = includedSortedRows.reduce((sum, row) => sum + Number(receivableAmount(row) || 0), 0);
  const bankBuyRate = bankBuyRateFrom(exchangeRate);
  const exchangeRateSummary = exchangeRate
    ? `Mid-rate ${Number(exchangeRate.rate || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}; bank buy rate ${Number(bankBuyRate || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}; applied rate date ${fmtDate(exchangeRate.date)}`
    : exchangeRateError || 'USD/CNY rate unavailable';
  const filterSummaryRows = [
    ['Broker Name', selectedBrokerNames.length ? selectedBrokerNames.join(', ') : 'All'],
    ['Broker Type', selectedTypes.length ? selectedTypes.map(brokerTypeLabel).join(', ') : 'All'],
    ['Date Range', `${fromDate || 'Any'} to ${toDate || 'Any'}`],
    ['Excluded Rows', visibleExcludedCount ? `${visibleExcludedCount.toLocaleString()} excluded from totals and export` : 'None'],
  ];
  const workbookCell = (value, styleId = 'Text', mergeAcross = 0) => {
    const mergeAttr = mergeAcross ? ` ss:MergeAcross="${mergeAcross}"` : '';
    return `<Cell ss:StyleID="${styleId}"${mergeAttr}><Data ss:Type="String">${escapeXmlText(value)}</Data></Cell>`;
  };
  const workbookNumberCell = (value, styleId = 'Number', mergeAcross = 0) => {
    const number = numericValue(value);
    const mergeAttr = mergeAcross ? ` ss:MergeAcross="${mergeAcross}"` : '';
    return number == null
      ? workbookCell('', styleId, mergeAcross)
      : `<Cell ss:StyleID="${styleId}"${mergeAttr}><Data ss:Type="Number">${number}</Data></Cell>`;
  };
  const workbookCurrencyCell = (value, styleId = 'Currency', mergeAcross = 0) => {
    const number = roundCurrency(value);
    const mergeAttr = mergeAcross ? ` ss:MergeAcross="${mergeAcross}"` : '';
    return number == null
      ? workbookCell('', styleId, mergeAcross)
      : `<Cell ss:StyleID="${styleId}"${mergeAttr}><Data ss:Type="Number">${number.toFixed(2)}</Data></Cell>`;
  };
  const workbookRow = (cells) => `<Row ss:AutoFitHeight="1">${cells.join('')}</Row>`;
  const workbookColumns = (widths) => widths
    .map((width) => `<Column ss:AutoFitWidth="1" ss:Width="${width}"/>`)
    .join('');
  const workbookStyles = (includeCny) => `<Styles>
      <Style ss:ID="Default" ss:Name="Normal">
        <Alignment ss:Vertical="Top"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Color="#111827"/>
      </Style>
      <Style ss:ID="Title">
        <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
        <Font ss:FontName="Arial" ss:Size="20" ss:Bold="1" ss:Color="#FFFFFF"/>
        <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
      </Style>
      <Style ss:ID="Subtitle">
        <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Color="#334155"/>
        <Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>
      </Style>
      <Style ss:ID="Section">
        <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#1E3A8A"/>
        <Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="Header">
        <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
        <Interior ss:Color="#334155" ss:Pattern="Solid"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="Label">
        <Alignment ss:Horizontal="Left" ss:Vertical="Top"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#64748B"/>
        <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="Text">
        <Alignment ss:Horizontal="Left" ss:Vertical="Top" ss:WrapText="1"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="TextRight">
        <Alignment ss:Horizontal="Right" ss:Vertical="Top" ss:WrapText="1"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="SummaryLabel">
        <Alignment ss:Horizontal="Left" ss:Vertical="Top" ss:WrapText="1"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#065F46"/>
        <Interior ss:Color="#ECFDF5" ss:Pattern="Solid"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="SummaryText">
        <Alignment ss:Horizontal="Left" ss:Vertical="Top" ss:WrapText="1"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#065F46"/>
        <Interior ss:Color="#ECFDF5" ss:Pattern="Solid"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="SummaryCurrency">
        <Alignment ss:Horizontal="Left" ss:Vertical="Top"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#065F46"/>
        <Interior ss:Color="#ECFDF5" ss:Pattern="Solid"/>
        <NumberFormat ss:Format="&quot;$&quot;#,##0.00"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="Currency">
        <Alignment ss:Horizontal="Right" ss:Vertical="Top"/>
        <NumberFormat ss:Format="&quot;$&quot;#,##0.00"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      ${includeCny ? `<Style ss:ID="Cny">
        <Alignment ss:Horizontal="Right" ss:Vertical="Top"/>
        <NumberFormat ss:Format="&quot;CNY &quot;#,##0.00"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="SummaryCny">
        <Alignment ss:Horizontal="Left" ss:Vertical="Top"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#065F46"/>
        <Interior ss:Color="#ECFDF5" ss:Pattern="Solid"/>
        <NumberFormat ss:Format="&quot;CNY &quot;#,##0.00"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="Rate">
        <Alignment ss:Horizontal="Right" ss:Vertical="Top"/>
        <NumberFormat ss:Format="#,##0.000000"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="SummaryRate">
        <Alignment ss:Horizontal="Left" ss:Vertical="Top"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#065F46"/>
        <Interior ss:Color="#ECFDF5" ss:Pattern="Solid"/>
        <NumberFormat ss:Format="#,##0.000000"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>` : ''}
    </Styles>`;
  const exportXls = async () => {
    if (archivingExport) return;
    const generatedAt = format(new Date(), 'dd MMM yyyy HH:mm');
    const bankBuyRateMethodology = 'Frankfurter USD/CNY API rate is treated as the mid-rate. Bank buy rate is calculated as mid-rate less 0.2%, i.e. mid-rate x 0.998.';
    const targetDateMethodology = 'The default exchange-rate target is the last working day of the quarter based on the selected To Date, otherwise selected From Date, otherwise the latest payment/delivery date in filtered rows, otherwise today. Weekends are moved back to Friday; public holidays are handled by the API fallback to prior available dates.';
    const bankBuyRateMethodologyZh = 'Frankfurter USD/CNY API 汇率视为中间价。银行买入价按中间价下调 0.2% 计算，即中间价 x 0.998。';
    const targetDateMethodologyZh = '默认汇率目标日期为所选结束日期所在季度的最后一个工作日；如未选择结束日期，则使用所选开始日期；如未选择开始日期，则使用筛选结果中最新的付款/交付日期；否则使用当天。周末会回退至星期五；公众假期由 API 回退至前一个可用汇率日期。';
    const exportNote = 'All commission amounts are exported from the filtered Broker\'s Commission rows shown in the application at the time of export.';
    const exportNoteZh = '所有佣金金额均来自导出时应用程序中已筛选的 Broker\'s Commission 行。';
    const methodologyRows = showCny ? [
      ['Generated At', generatedAt],
      ['Rows Exported', includedSortedRows.length.toLocaleString()],
      ['Source', exchangeRate?.source || 'Frankfurter API'],
      ['API URL', exchangeRate?.apiUrl || 'https://api.frankfurter.dev/v2/rate/USD/CNY'],
      ['Provider / Rate Type', exchangeRate ? `${exchangeRate.providerLabel} / ${exchangeRate.rateType}` : exchangeRateProvider],
      ['Exchange-rate target date', exchangeRateTargetDate],
      ['Requested rate date', exchangeRate?.requestedDate || exchangeRateTargetDate],
      ['Applied rate date', exchangeRate?.date || 'Unavailable'],
      ['Mid-rate', exchangeRate?.rate != null ? Number(exchangeRate.rate).toFixed(6) : 'Unavailable'],
      ['Bank buy rate methodology', bankBuyRateMethodology],
      ['Target-date methodology', targetDateMethodology],
    ] : [];
    const methodologyRowsZh = showCny ? [
      ['生成时间', generatedAt],
      ['导出行数', includedSortedRows.length.toLocaleString()],
      ['来源', exchangeRate?.source || 'Frankfurter API'],
      ['API 地址', exchangeRate?.apiUrl || 'https://api.frankfurter.dev/v2/rate/USD/CNY'],
      ['提供方 / 汇率类型', exchangeRate ? `${exchangeRate.providerLabel} / ${exchangeRate.rateType}` : exchangeRateProvider],
      ['汇率目标日期', exchangeRateTargetDate],
      ['请求汇率日期', exchangeRate?.requestedDate || exchangeRateTargetDate],
      ['实际使用汇率日期', exchangeRate?.date || '不可用'],
      ['中间价', exchangeRate?.rate != null ? Number(exchangeRate.rate).toFixed(6) : '不可用'],
      ['银行买入价方法', bankBuyRateMethodologyZh],
      ['目标日期方法', targetDateMethodologyZh],
    ] : [];
    const detailRows = includedSortedRows.map((row) => ({
      brokerName: brokerNameValue(row),
      stemName: row.stemName,
      productQuantity: spreadsheetText(row.productQuantityLabel || row.productFamily || row.productName),
      deliveryDate: fmtDate(row.deliveryDate),
      brokerType: brokerTypeLabel(row.brokerType),
      commissionUnit: spreadsheetText(row.commissionUnitPriceLabel || fmtUnit(row.commissionUnitPrice)),
      commissionPayable: payableAmount(row),
      commissionReceivable: receivableAmount(row),
      paymentDateLabel: row.paymentDateLabel,
      paymentDate: fmtDate(row.paymentDate),
      paymentDelay: row.paymentDelayLabel || (brokerTypeLabel(row.brokerType) === 'Buyer Broker' ? fmtDelay(row.paymentDelay) : ''),
    }));
    const hasCommissionPayable = detailRows.some((row) => numericValue(row.commissionPayable) != null);
    const hasCommissionReceivable = detailRows.some((row) => numericValue(row.commissionReceivable) != null);
    const hasPaymentDelay = detailRows.some((row) => textValue(row.paymentDelay, '').trim());
    const priorityHeader = (label, key) => sortPriority[key] ? `${sortPriority[key]} ${label}` : label;
    const detailColumns = [
      { key: 'stemName', header: priorityHeader('Stem Name', 'stemName'), value: (row) => row.stemName, cell: (row) => workbookCell(row.stemName), minWidth: 110, maxWidth: 280 },
      { key: 'brokerName', header: priorityHeader('Broker Name', 'brokerName'), value: (row) => row.brokerName, cell: (row) => workbookCell(row.brokerName), minWidth: 120, maxWidth: 280 },
      { key: 'productQuantity', header: 'Products / Quantity', value: (row) => row.productQuantity, cell: (row) => workbookCell(row.productQuantity), minWidth: 110, maxWidth: 280 },
      { key: 'deliveryDate', header: priorityHeader('Delivery Date', 'deliveryDate'), value: (row) => row.deliveryDate, cell: (row) => workbookCell(row.deliveryDate), minWidth: 85, maxWidth: 180 },
      { key: 'brokerType', header: priorityHeader('Broker Type', 'brokerType'), value: (row) => row.brokerType, cell: (row) => workbookCell(row.brokerType), minWidth: 85, maxWidth: 180 },
      { key: 'commissionUnit', header: 'Commission / Unit', value: (row) => row.commissionUnit, cell: (row) => workbookCell(row.commissionUnit, 'TextRight'), minWidth: 85, maxWidth: 180 },
      ...(hasCommissionPayable ? [{ key: 'commissionPayable', header: 'Commission Payable', value: (row) => row.commissionPayable, cell: (row) => workbookCurrencyCell(row.commissionPayable), minWidth: 105, maxWidth: 180 }] : []),
      ...(hasCommissionReceivable ? [{ key: 'commissionReceivable', header: 'Commission Receivable', value: (row) => row.commissionReceivable, cell: (row) => workbookCurrencyCell(row.commissionReceivable), minWidth: 105, maxWidth: 190 }] : []),
      { key: 'paymentDateLabel', header: 'Payment Date Label', value: (row) => row.paymentDateLabel, cell: (row) => workbookCell(row.paymentDateLabel), minWidth: 85, maxWidth: 180 },
      { key: 'paymentDate', header: 'Payment Date', value: (row) => row.paymentDate, cell: (row) => workbookCell(row.paymentDate), minWidth: 85, maxWidth: 180 },
      ...(hasPaymentDelay ? [{ key: 'paymentDelay', header: 'Payment Delay', value: (row) => row.paymentDelay, cell: (row) => workbookCell(row.paymentDelay, 'TextRight'), minWidth: 85, maxWidth: 180 }] : []),
    ];
    const detailBrokerSections = [];
    for (const row of detailRows) {
      const brokerName = row.brokerName || 'Unknown Broker';
      const current = detailBrokerSections.at(-1);
      if (current && current.brokerName === brokerName) {
        current.rows.push(row);
      } else {
        detailBrokerSections.push({ brokerName, rows: [row] });
      }
    }
    const brokerSummaryCells = (label, rowsForBroker, cny = false) => {
      const payable = rowsForBroker.reduce((sum, row) => sum + Number(row.commissionPayable || 0), 0);
      const receivable = rowsForBroker.reduce((sum, row) => sum + Number(row.commissionReceivable || 0), 0);
      const payableValue = cny ? (bankBuyRate != null ? payable * bankBuyRate : null) : payable;
      const receivableValue = cny ? (bankBuyRate != null ? receivable * bankBuyRate : null) : receivable;
      return detailColumns.map((column, index) => {
        if (index === 0) return workbookCell(label, 'SummaryLabel');
        if (column.key === 'commissionPayable') return workbookCurrencyCell(payableValue, cny ? 'SummaryCny' : 'SummaryCurrency');
        if (column.key === 'commissionReceivable') return workbookCurrencyCell(receivableValue, cny ? 'SummaryCny' : 'SummaryCurrency');
        return workbookCell('', 'SummaryText');
      });
    };
    const detailBodyRows = detailBrokerSections.flatMap((section) => [
      ...section.rows.map((row) => workbookRow(detailColumns.map((column) => column.cell(row)))),
      workbookRow(brokerSummaryCells(`Broker Summary - ${section.brokerName}`, section.rows)),
      ...(showCny ? [workbookRow(brokerSummaryCells(`Broker Summary in CNY - ${section.brokerName}`, section.rows, true))] : []),
    ]);
    const detailColumnCount = detailColumns.length;
    const detailMergeAcross = Math.max(0, detailColumnCount - 1);
    const labelValueMergeAcross = Math.max(0, detailColumnCount - 2);
    const brokerColumnValues = detailColumns.map((column, index) => [
      ...(index === 0 ? ['Broker\'s Commission'] : []),
      column.header,
      ...detailRows.map((row) => column.value(row)),
    ]);
    const brokerRows = [
      workbookRow([workbookCell('Broker\'s Commission', 'Title', detailMergeAcross)]),
      workbookRow([workbookCell(`Generated ${generatedAt} · ${includedSortedRows.length.toLocaleString()} included rows · ${visibleExcludedCount.toLocaleString()} excluded rows · Filtered commission total ${fmtMoney(total)}`, 'Subtitle', detailMergeAcross)]),
      workbookRow([workbookCell('Applied Filters', 'Section', detailMergeAcross)]),
      ...filterSummaryRows.map(([label, value]) => workbookRow([workbookCell(label, 'Label'), workbookCell(value, 'Text', labelValueMergeAcross)])),
      workbookRow([workbookCell('Summary', 'Section', detailMergeAcross)]),
      workbookRow([workbookCell('Commission Payable', 'SummaryLabel'), workbookCurrencyCell(commissionPayableTotal, 'SummaryCurrency', labelValueMergeAcross)]),
      workbookRow([workbookCell('Commission Receivable', 'SummaryLabel'), workbookCurrencyCell(commissionReceivableTotal, 'SummaryCurrency', labelValueMergeAcross)]),
      workbookRow([workbookCell('Net Commission Total', 'SummaryLabel'), workbookCurrencyCell(total, 'SummaryCurrency', labelValueMergeAcross)]),
      ...(showCny ? [
        workbookRow([workbookCell('Commission Payable in CNY', 'SummaryLabel'), workbookCurrencyCell(bankBuyRate != null ? commissionPayableTotal * bankBuyRate : null, 'SummaryCny', labelValueMergeAcross)]),
        workbookRow([workbookCell('Commission Receivable in CNY', 'SummaryLabel'), workbookCurrencyCell(bankBuyRate != null ? commissionReceivableTotal * bankBuyRate : null, 'SummaryCny', labelValueMergeAcross)]),
        workbookRow([workbookCell('Bank Buy Rate', 'SummaryLabel'), workbookNumberCell(bankBuyRate, 'SummaryRate', labelValueMergeAcross)]),
        workbookRow([workbookCell('Exchange Rate', 'SummaryLabel'), workbookCell(exchangeRateSummary, 'SummaryText', labelValueMergeAcross)]),
      ] : []),
      workbookRow([workbookCell('Broker Commission Rows', 'Section', detailMergeAcross)]),
      workbookRow(detailColumns.map((column) => workbookCell(column.header, 'Header'))),
      ...(detailRows.length
        ? detailBodyRows
        : [workbookRow([workbookCell('No broker commissions found.', 'Text', detailMergeAcross)])]),
    ];
    const settingsColumnValues = showCny ? [
      ['Settings', ...methodologyRows.map(([label]) => label), '汇率来源和方法（简体中文）', ...methodologyRowsZh.map(([label]) => label), 'Note', '备注'],
      ['Exchange Rate Source and Methodology', ...methodologyRows.map(([, value]) => value), 'Exchange Rate Source and Methodology (Simplified Chinese)', ...methodologyRowsZh.map(([, value]) => value), exportNote, exportNoteZh],
    ] : [];
    const settingsRows = showCny ? [
      workbookRow([workbookCell('Settings', 'Title', 1)]),
      workbookRow([workbookCell('Exchange Rate Source and Methodology', 'Section', 1)]),
      ...methodologyRows.map(([label, value]) => workbookRow([workbookCell(label, 'Label'), workbookCell(value, 'Text')])),
      workbookRow([workbookCell('汇率来源和方法（简体中文）', 'Section', 1)]),
      ...methodologyRowsZh.map(([label, value]) => workbookRow([workbookCell(label, 'Label'), workbookCell(value, 'Text')])),
      workbookRow([workbookCell('Note', 'Label'), workbookCell(exportNote, 'Text')]),
      workbookRow([workbookCell('备注', 'Label'), workbookCell(exportNoteZh, 'Text')]),
    ] : [];
    const settingsWorksheet = showCny ? `
        <Worksheet ss:Name="Settings">
          <Table ss:ExpandedColumnCount="2" ss:ExpandedRowCount="${settingsRows.length}" x:FullColumns="1" x:FullRows="1">
            ${workbookColumns(settingsColumnValues.map((values, index) => columnWidth(values, index === 0 ? 150 : 260, index === 0 ? 260 : 620)))}
            ${settingsRows.join('')}
          </Table>
        </Worksheet>` : '';
    const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
      <?mso-application progid="Excel.Sheet"?>
      <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
        xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:x="urn:schemas-microsoft-com:office:excel"
        xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
        xmlns:html="http://www.w3.org/TR/REC-html40">
        <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
          <Title>Broker's Commission</Title>
          <Author>Salesforce Analytics Hub</Author>
          <Created>${new Date().toISOString()}</Created>
        </DocumentProperties>
        ${workbookStyles(showCny)}
        <Worksheet ss:Name="Broker Commission">
          <Table ss:ExpandedColumnCount="${detailColumnCount}" ss:ExpandedRowCount="${brokerRows.length}" x:FullColumns="1" x:FullRows="1">
            ${workbookColumns(brokerColumnValues.map((values, index) => columnWidth(values, detailColumns[index].minWidth, detailColumns[index].maxWidth)))}
            ${brokerRows.join('')}
          </Table>
        </Worksheet>
        ${settingsWorksheet}
      </Workbook>`;
    const blob = new Blob([workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    downloadBlob(blob, exportFileName);
    setArchivingExport(true);
    try {
      const res = await appClient.functions.invoke('reportExportCreate', {
        reportType: 'broker_commission',
        reportLabel: "Broker's Commission",
        fileName: exportFileName,
        mimeType: 'application/vnd.ms-excel',
        contentBase64: textToBase64(workbookXml),
        metadata: {
          reportTitle: "Broker's Commission",
          generatedAt,
          rowCount: includedSortedRows.length,
          excludedRowCount: visibleExcludedCount,
          totalCommission: roundCurrency(total),
          commissionPayableTotal: roundCurrency(commissionPayableTotal),
          commissionReceivableTotal: roundCurrency(commissionReceivableTotal),
          cnyEnabled: showCny,
          exchangeRate: showCny ? {
            source: exchangeRate?.source || 'Frankfurter API',
            targetDate: exchangeRateTargetDate,
            requestedDate: exchangeRate?.requestedDate || exchangeRateTargetDate,
            appliedDate: exchangeRate?.date || null,
            midRate: exchangeRate?.rate ?? null,
            bankBuyRate,
            summary: exchangeRateSummary,
          } : null,
          filters: Object.fromEntries(filterSummaryRows),
          filterSummaryRows,
        },
      });
      if (res.data?.error) {
        toast({
          title: 'XLS downloaded, Drive archive failed',
          description: res.data.error,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'XLS downloaded and archived',
          description: `${exportFileName} was saved to Google Drive.`,
        });
        appClient.functions.clearCache();
      }
    } catch (archiveError) {
      toast({
        title: 'XLS downloaded, Drive archive failed',
        description: archiveError.message || 'Unable to save this report to Google Drive.',
        variant: 'destructive',
      });
    } finally {
      setArchivingExport(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        eyebrow="Salesforce broker commissions"
        title="Broker's Commission"
        description="Review supplier, buyer, and secondary buyer broker commissions with payment timing and hidden broker flags."
        meta={`${filteredRows.length.toLocaleString()} rows · ${fmtMoney(total)} filtered commission total`}
        actions={(
          <>
          <Button type="button" size="sm" variant={showCny ? 'default' : 'outline'} onClick={() => setShowCny(value => !value)} className="gap-2 w-fit">
            CNY
          </Button>
          <Button variant="outline" onClick={exportXls} disabled={loading || archivingExport || !includedSortedRows.length} className="gap-2 w-fit">
            {archivingExport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export XLS
          </Button>
          <Button variant="outline" onClick={() => loadRows({ force: true })} disabled={loading} className="gap-2 w-fit">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          </>
        )}
      />

      <BrokerFilters search={search} setSearch={setSearch} selectedTypes={selectedTypes} setSelectedTypes={setSelectedTypes} brokerNames={brokerNames} selectedBrokerNames={selectedBrokerNames} setSelectedBrokerNames={setSelectedBrokerNames} selectedHiddenBrokerFlags={selectedHiddenBrokerFlags} setSelectedHiddenBrokerFlags={setSelectedHiddenBrokerFlags} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="rounded-xl border border-border bg-card px-5 py-4 flex flex-wrap gap-6">
        <div><div className="text-xs text-muted-foreground uppercase tracking-wide">Rows</div><div className="text-xl font-bold">{includedSortedRows.length.toLocaleString()} / {filteredRows.length.toLocaleString()}</div></div>
        <div><div className="text-xs text-muted-foreground uppercase tracking-wide">Commission Total</div><div className="text-xl font-bold">{fmtMoney(total)}</div></div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Excluded</div>
          <div className="text-xl font-bold">{visibleExcludedCount.toLocaleString()}</div>
        </div>
        {showCny && (
          <div className="min-w-72 flex-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">USD/CNY Exchange Rate</div>
            <div className="mt-1 text-xs text-muted-foreground">
              API rate is treated as mid-rate. CNY conversion uses bank buy rate: mid-rate less 0.2%.
              {exchangeRateLoading && ' Loading rate...'}
              {exchangeRateError && <span className="text-destructive"> {exchangeRateError}</span>}
              {exchangeRate && !exchangeRateLoading && (
                <span> Mid-rate: {Number(exchangeRate.rate).toLocaleString(undefined, { maximumFractionDigits: 6 })} on {fmtDate(exchangeRate.date)} · {exchangeRate.source} · {exchangeRate.rateType}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {loading && <StateBlock icon={Loader2} title="Loading broker commissions..." description="Fetching commissions, payment timing, and broker flags from Salesforce." />}
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {!loading && !error && (
        <TableShell
          title="Broker Commission Rows"
          meta={`${includedSortedRows.length.toLocaleString()} included · ${visibleExcludedCount.toLocaleString()} excluded · ${filteredRows.length.toLocaleString()} matching rows`}
          bodyClassName="p-0"
          actions={visibleExcludedCount ? (
            <Button type="button" variant="outline" size="sm" onClick={clearVisibleExclusions}>
              Clear exclusions
            </Button>
          ) : null}
        >
          <BrokerRegisterTable
            rows={sortedRows}
            onRowClick={setSelectedStemId}
            exchangeRate={exchangeRate}
            exchangeRateLoading={exchangeRateLoading}
            exchangeRateError={exchangeRateError}
            showCny={showCny}
            sortPriority={sortPriority}
            excludedRowIds={excludedRowIdSet}
            onToggleExcluded={toggleRowExcluded}
          />
        </TableShell>
      )}

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} onUpdated={() => loadRows({ force: true })} />
    </div>
  );
}
