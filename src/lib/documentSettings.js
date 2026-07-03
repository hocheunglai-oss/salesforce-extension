export const DOCUMENT_SETTINGS_KEY = 'salesforce_extension:stem_document_settings';

export const DOCUMENT_SOURCE_GROUPS = [
  'Direct STEM',
  'Buyer / Factoring Invoice',
  'Supplier Invoice',
  'Nomination',
  'Dispute / Support',
  'Line Item',
  'Extra Cost',
  'Broker',
  'Email',
  'Other Related',
];

export const DEFAULT_DOCUMENT_SETTINGS = {
  relevantSourceGroups: [
    'Direct STEM',
    'Buyer / Factoring Invoice',
    'Supplier Invoice',
    'Nomination',
    'Dispute / Support',
    'Email',
  ],
  showOnlyRelevant: true,
};

export function readDocumentSettings() {
  try {
    const raw = localStorage.getItem(DOCUMENT_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const groups = Array.isArray(parsed.relevantSourceGroups)
      ? parsed.relevantSourceGroups.filter((group) => DOCUMENT_SOURCE_GROUPS.includes(group))
      : DEFAULT_DOCUMENT_SETTINGS.relevantSourceGroups;
    return {
      ...DEFAULT_DOCUMENT_SETTINGS,
      ...parsed,
      relevantSourceGroups: groups.length ? groups : DEFAULT_DOCUMENT_SETTINGS.relevantSourceGroups,
      showOnlyRelevant: parsed.showOnlyRelevant ?? DEFAULT_DOCUMENT_SETTINGS.showOnlyRelevant,
    };
  } catch {
    return DEFAULT_DOCUMENT_SETTINGS;
  }
}

export function saveDocumentSettings(settings) {
  const relevantSourceGroups = Array.isArray(settings?.relevantSourceGroups)
    ? settings.relevantSourceGroups.filter((group) => DOCUMENT_SOURCE_GROUPS.includes(group))
    : DEFAULT_DOCUMENT_SETTINGS.relevantSourceGroups;
  localStorage.setItem(DOCUMENT_SETTINGS_KEY, JSON.stringify({
    relevantSourceGroups,
    showOnlyRelevant: settings?.showOnlyRelevant ?? DEFAULT_DOCUMENT_SETTINGS.showOnlyRelevant,
  }));
}
