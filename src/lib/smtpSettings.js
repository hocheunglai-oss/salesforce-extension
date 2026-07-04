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

export function smtpFromAddress(settings) {
  const email = String(settings?.fromEmail || settings?.user || '').trim();
  if (!email) return '';
  const name = String(settings?.fromName || '').trim();
  return name ? `${name} <${email}>` : email;
}
