export const EXCHANGE_RATE_SETTINGS_KEY = 'broker_commission_exchange_rate_v1';

export const RATE_PROVIDER_OPTIONS = [
  { value: 'blended', label: 'Frankfurter blended rate' },
  { value: 'ECB', label: 'European Central Bank reference rate' },
  { value: 'HKMA', label: 'Hong Kong Monetary Authority published rate' },
  { value: 'BOC', label: 'Bank of Canada indicative rate' },
];

export const DEFAULT_EXCHANGE_RATE_SETTINGS = {
  provider: 'blended',
};

export function readExchangeRateSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(EXCHANGE_RATE_SETTINGS_KEY) || '{}');
    const provider = RATE_PROVIDER_OPTIONS.some((option) => option.value === saved.provider)
      ? saved.provider
      : DEFAULT_EXCHANGE_RATE_SETTINGS.provider;
    return { ...DEFAULT_EXCHANGE_RATE_SETTINGS, ...saved, provider };
  } catch {
    return DEFAULT_EXCHANGE_RATE_SETTINGS;
  }
}

export function saveExchangeRateSettings(settings) {
  const provider = RATE_PROVIDER_OPTIONS.some((option) => option.value === settings?.provider)
    ? settings.provider
    : DEFAULT_EXCHANGE_RATE_SETTINGS.provider;
  localStorage.setItem(EXCHANGE_RATE_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_EXCHANGE_RATE_SETTINGS, ...settings, provider }));
}
