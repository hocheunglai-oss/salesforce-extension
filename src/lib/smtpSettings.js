export const SMTP_SETTINGS_KEY = 'salesforce_extension:smtp_email_credentials';
export const PAYMENT_REMINDER_SMTP_SETTINGS_KEY = 'salesforce_extension:payment_reminder_smtp_email_credentials';

export const DEFAULT_SMTP_SETTINGS = {
  enabled: false,
  host: 'smtp.office365.com',
  port: '587',
  user: 'info@cosulich.com.hk',
  password: '',
  secure: false,
  fromName: 'Fratelli Cosulich',
  fromEmail: 'info@cosulich.com.hk',
};

export const DEFAULT_PAYMENT_REMINDER_SMTP_SETTINGS = {
  ...DEFAULT_SMTP_SETTINGS,
  user: '',
  fromEmail: '',
};

export function readSmtpSettings() {
  try {
    const raw = localStorage.getItem(SMTP_SETTINGS_KEY);
    return raw ? { ...DEFAULT_SMTP_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SMTP_SETTINGS;
  } catch {
    return DEFAULT_SMTP_SETTINGS;
  }
}

export function saveSmtpSettings(settings) {
  localStorage.setItem(SMTP_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SMTP_SETTINGS, ...settings }));
}

export function readPaymentReminderSmtpSettings() {
  try {
    const raw = localStorage.getItem(PAYMENT_REMINDER_SMTP_SETTINGS_KEY);
    return raw ? { ...DEFAULT_PAYMENT_REMINDER_SMTP_SETTINGS, ...JSON.parse(raw) } : DEFAULT_PAYMENT_REMINDER_SMTP_SETTINGS;
  } catch {
    return DEFAULT_PAYMENT_REMINDER_SMTP_SETTINGS;
  }
}

export function savePaymentReminderSmtpSettings(settings) {
  localStorage.setItem(PAYMENT_REMINDER_SMTP_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_PAYMENT_REMINDER_SMTP_SETTINGS, ...settings }));
}

export function hasUsableSmtpSettings(settings) {
  return Boolean(settings?.enabled && settings.host && settings.user && settings.password);
}

function parseSenderAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return { name: '', email: '' };
  const match = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>\s*$/);
  if (match) return { name: String(match[1] || '').trim(), email: match[2].trim() };
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  return { name: email && raw !== email ? raw.replace(email, '').replace(/[<>()"]/g, '').trim() : '', email };
}

export function smtpFromAddress(settings, fallbackFrom = '') {
  const fallback = parseSenderAddress(fallbackFrom);
  const email = String(settings?.fromEmail || fallback.email || settings?.user || '').trim();
  if (!email) return '';
  const name = String(settings?.fromName || fallback.name || '').trim();
  return name ? `${name} <${email}>` : email;
}
