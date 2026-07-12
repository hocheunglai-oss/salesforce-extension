const LEGACY_SMTP_SETTINGS_KEYS = [
  'fcos:smtp_email_credentials',
  'fcos:payment_reminder_smtp_email_credentials',
];

export function clearLegacyPaymentReminderSmtpSettings() {
  if (typeof localStorage === 'undefined') return;
  try {
    LEGACY_SMTP_SETTINGS_KEYS.forEach((key) => localStorage.removeItem(key));
    const draftKey = 'fcos:draft:settings:page';
    const rawDraft = localStorage.getItem(draftKey);
    if (!rawDraft) return;
    const draft = JSON.parse(rawDraft);
    if (!draft?.data) return;
    delete draft.data.smtpSettings;
    delete draft.data.paymentReminderSmtpSettings;
    localStorage.setItem(draftKey, JSON.stringify(draft));
  } catch {
    // Ignore cleanup failures in restricted browser storage.
  }
}
