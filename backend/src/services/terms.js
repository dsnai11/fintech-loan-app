import { getConfig, setConfig } from './configService.js';
import { getPolicy } from './pricingPolicy.js';

// The terms and conditions customers accept when they sign up. Staff edit them in the web portal; every time
// a new version is published, customers are asked to accept again.
// Format: plain text. A line starting with "# " is a heading; blank lines separate paragraphs.
// {{lenderName}} and {{grievance}} are filled in from the lender details on the Pricing page.

export const DEFAULT_TITLE = 'Terms and Conditions';
export const DEFAULT_TEXT = `# 1. About these terms
These terms are between you and {{lenderName}} ("we", "us"). By creating an account or using this app you agree to them. If you do not agree, please do not use the app.

# 2. Your account
You must be an adult resident of India and give us correct details. Keep your password and phone private. You are responsible for everything done through your account. Tell us at once if you think someone else is using it.

# 3. Verifying you
We may check your identity, phone number, PAN, bank account and credit record before and during a loan. You agree to give us true documents and information. We can refuse or stop an application if we cannot verify you.

# 4. Loans and charges
Before you accept a loan, the app shows a Key Fact Statement with the amount, interest, processing fee, GST, total repayment, and the annual cost (APR). Those are the terms of your loan. A loan is only approved when we say so, and money is sent only after you accept the loan agreement.

# 5. Repayment and late payment
You agree to pay each instalment on its due date. If an instalment is late, the late fee in your Key Fact Statement applies, and we may contact you to collect the amount due. You may close a loan early by paying the amount shown in the app. A loan may have a short period after payout in which you can cancel it, as shown in your agreement.

# 6. Privacy and your data
We collect and use your personal data to run your account, check eligibility, collect dues, meet legal duties, and improve our service. We share it only with partners who help us do this (such as identity, payment and credit check providers) and with authorities where the law requires. You can ask for a copy of your data or ask us to delete it from the Privacy screen in the app, subject to records we must keep by law.

# 7. Messages from us
We will send you messages about your account by SMS, email and in the app, including reminders and payment notices. These are service messages and are not marketing.

# 8. Complaints
If you are not satisfied with our service, write to us first using the Help screen. If it is not resolved, you can write to our grievance officer.
{{grievance}}

# 9. Changes
We may update these terms. When we do, the app will ask you to read and accept the new version before you continue. Loans you already have keep the terms they were given.

# 10. Law
These terms are governed by the laws of India. Courts in India have jurisdiction over any dispute.`;

const clone = o => JSON.parse(JSON.stringify(o));

export function getTermsRaw() {
  let stored = null;
  try {
    const raw = getConfig('TERMS', '');
    if (raw) stored = JSON.parse(raw);
  } catch (e) { /* defaults */ }
  return { version: 1, title: DEFAULT_TITLE, text: DEFAULT_TEXT, updatedAt: null, updatedBy: 'system', ...clone(stored || {}) };
}

export const currentVersion = () => getTermsRaw().version;

// What customers read: placeholders filled in.
export function publicTerms() {
  const t = getTermsRaw();
  const inst = getPolicy().institution;
  const grievance = [inst.grievanceOfficerName, inst.grievanceOfficerEmail, inst.grievanceOfficerPhone].filter(Boolean).join(', ');
  const text = t.text
    .replace(/\{\{lenderName\}\}/g, inst.lenderName || 'the lender')
    .replace(/\{\{grievance\}\}/g, grievance ? `Grievance officer: ${grievance}.` : '');
  return { version: t.version, title: t.title, text: text.trim(), updatedAt: t.updatedAt };
}

export async function saveTerms({ title, text }, updatedBy) {
  const t = String(text ?? '').trim();
  const ti = String(title ?? DEFAULT_TITLE).trim();
  if (!ti || ti.length > 80) return { ok: false, error: 'Give the terms a title of up to 80 characters' };
  if (t.length < 200) return { ok: false, error: 'The terms look too short. Write the full text (at least 200 characters).' };
  if (t.length > 60000) return { ok: false, error: 'The terms are too long (up to 60,000 characters).' };
  const old = getTermsRaw();
  if (old.title === ti && old.text === t) return { ok: false, error: 'Nothing has changed, so no new version was published.' };
  const next = { version: old.version + 1, title: ti, text: t, updatedAt: new Date().toISOString(), updatedBy };
  await setConfig('TERMS', JSON.stringify(next), { group: 'app', updatedBy });
  return { ok: true, terms: next };
}

// Customers have to accept the current version. Staff accounts are not asked.
export const termsRequiredFor = user => process.env.REQUIRE_TERMS !== 'false' && (user.termsVersion || 0) < currentVersion();

export default { publicTerms, saveTerms, getTermsRaw, currentVersion, termsRequiredFor };
