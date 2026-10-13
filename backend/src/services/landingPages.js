import { getConfig, setConfig } from './configService.js';
import { getPolicy, computeQuote } from './pricingPolicy.js';
import { policyFor } from './appSettings.js';
import { getRules } from './decisionEngine.js';
import { getSettings as paydaySettings, quoteFor as paydayQuote } from './paydayService.js';
import { CONSENT_TEXT } from './leadService.js';

// Public pages for people searching for a loan ("1 lakh personal loan", "salary advance"). All of them lead to the same place: the
// one application in the app. Each page shows a worked example from the company's real pricing (never a made-up rate), the
// plain requirements, and a form to ask for a call. The whole thing is off until the company has checked the advertising wording.

const KEY = 'LANDING_PAGES';
export const PRODUCTS = ['personal', 'payday'];

const DEFAULT_PAGES = [
  { slug: '5000-rupees-personal-loan', product: 'personal', amount: 5000, title: 'Rs 5,000 personal loan', h1: 'A Rs 5,000 personal loan for the days before payday', intro: 'Need a small amount quickly? Apply in the LIFC app, see every charge before you accept, and repay in easy instalments.' },
  { slug: '10000-rupees-personal-loan', product: 'personal', amount: 10000, title: 'Rs 10,000 personal loan', h1: 'Rs 10,000 personal loan, applied for on your phone', intro: 'Apply online with your PAN and a quick selfie. No paperwork to post, and the full cost is shown first.' },
  { slug: '50000-rupees-personal-loan', product: 'personal', amount: 50000, title: 'Rs 50,000 personal loan', h1: 'Rs 50,000 personal loan with the charges shown up front', intro: 'For bigger needs: choose the amount and the months that suit you, and see exactly what you will repay.' },
  { slug: '1-lakh-personal-loan', product: 'personal', amount: 100000, title: 'Rs 1 lakh personal loan', h1: 'Rs 1 lakh personal loan, fully online', intro: 'Verify yourself in the app, see your offer, sign online and get the money in your bank account.' },
  { slug: 'salary-advance-loan', product: 'payday', amount: 10000, title: 'Salary advance loan', h1: 'Get part of your salary early, repay it on payday', intro: 'A short advance against your salary. One flat fee, no monthly instalments, and you repay in one go on your next payday.' },
];
const DEFAULTS = { enabled: false, baseUrl: '', links: { android: '', ios: '', web: '' }, pages: DEFAULT_PAGES.map(p => ({ ...p, enabled: true })) };

const clone = o => JSON.parse(JSON.stringify(o));
export function getConfigObj() {
  try {
    const raw = getConfig(KEY, '');
    if (raw) {
      const s = JSON.parse(raw);
      return { ...clone(DEFAULTS), ...s, links: { ...DEFAULTS.links, ...(s.links || {}) }, pages: Array.isArray(s.pages) ? s.pages : clone(DEFAULTS.pages) };
    }
  } catch (e) { /* defaults */ }
  return clone(DEFAULTS);
}

const isUrl = u => /^https:\/\/[^\s]+$/i.test(u);

export function validate(input) {
  const errors = [];
  const out = { enabled: input?.enabled === true || input?.enabled === 'true', baseUrl: String(input?.baseUrl ?? '').trim().replace(/\/+$/, ''), links: {}, pages: [] };
  if (out.baseUrl && !isUrl(out.baseUrl)) errors.push('The website address must start with https://');
  for (const k of ['android', 'ios', 'web']) {
    const v = String(input?.links?.[k] ?? '').trim();
    if (v && !isUrl(v)) errors.push(`The ${k} link must start with https://`);
    out.links[k] = v;
  }
  const seen = new Set();
  const list = Array.isArray(input?.pages) ? input.pages : [];
  if (list.length > 60) errors.push('Up to 60 pages');
  list.slice(0, 60).forEach((p, i) => {
    const label = `Page ${i + 1}`;
    const slug = String(p?.slug ?? '').trim().toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 60) { errors.push(`${label}: the web address part must be 3 to 60 letters, numbers and hyphens (for example 1-lakh-personal-loan)`); return; }
    if (seen.has(slug)) { errors.push(`${label}: "${slug}" is used twice`); return; }
    seen.add(slug);
    const product = PRODUCTS.includes(p.product) ? p.product : 'personal';
    const amount = Number(p.amount);
    if (!Number.isInteger(amount) || amount < 1000 || amount > 10000000) { errors.push(`${label}: the example amount must be a whole number between Rs 1,000 and Rs 1,00,00,000`); return; }
    const t = (v, max, name) => { const s = String(v ?? '').trim(); if (!s) errors.push(`${label}: ${name} is required`); if (s.length > max) errors.push(`${label}: ${name} is too long (up to ${max} characters)`); return s.slice(0, max); };
    out.pages.push({ slug, product, amount, enabled: p.enabled !== false, title: t(p.title, 70, 'the page title'), h1: t(p.h1, 90, 'the heading'), intro: t(p.intro, 300, 'the introduction') });
  });
  return { errors, config: out };
}

export async function save(input, by) {
  const { errors, config } = validate(input);
  if (errors.length) return { ok: false, errors };
  await setConfig(KEY, JSON.stringify(config), { group: 'website', updatedBy: by });
  return { ok: true, config };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => 'Rs ' + Math.round(n).toLocaleString('en-IN');

// A page is served only when the whole site is on, the page is on, and (for the payday advance) that product is on
export function findPage(slug) {
  const c = getConfigObj();
  if (!c.enabled) return null;
  const page = c.pages.find(p => p.slug === slug && p.enabled);
  if (!page) return null;
  if (page.product === 'payday' && !paydaySettings().enabled) return null;
  return { config: c, page };
}

// The worked example, from the real pricing. null when the amount is outside what the product lends.
export function example(page) {
  if (page.product === 'payday') {
    const s = paydaySettings();
    if (page.amount < s.minAmount || page.amount > s.maxAmount) return null;
    const q = paydayQuote(page.amount, 28);
    if (!q) return null;
    return { lines: [['You ask for', inr(q.amount)], ['One flat fee, with GST', inr(q.totalCharges)], ['You receive', inr(q.netDisbursed)], ['You repay, in one go on your payday', inr(q.totalRepayable)]], apr: q.aprPercent, note: `Worked out for a salary on the 28th, about ${q.payday.days} days away. Your own date and cost are shown before you apply.` };
  }
  const policy = policyFor('personal') || getPolicy();
  if (page.amount < policy.minAmount || page.amount > policy.maxAmount) return null;
  const months = Math.min(policy.maxTenureMonths, 12);
  const q = computeQuote(policy, { amount: page.amount, planType: 'standard', tenureMonths: months }, {});
  return { lines: [['Loan amount', inr(q.amount)], ['Over', `${q.tenureMonths} months`], ['Monthly instalment (EMI)', inr(q.emi)], ['Processing fee and GST', inr(q.totalCharges)], ['You receive', inr(q.netDisbursed)], ['You repay in total', inr(q.totalRepayable)]], apr: q.aprPercent, note: `An example over ${months} months. The amount, months and cost you are offered depend on your income and credit record, and are shown in full before you accept.` };
}

export function renderPage({ config, page }, baseUrl) {
  const policy = getPolicy();
  const inst = policy.institution || {};
  const ex = example(page);
  const rules = getRules();
  const url = `${baseUrl}/loan/${page.slug}`;
  const faqs = [
    ['Who can apply?', `Customers aged ${rules.age.min} to ${rules.age.max} with a regular income, a PAN, a mobile number linked to Aadhaar and a bank account in their own name. Approval is subject to our checks.`],
    ['What will it cost?', ex ? `The example on this page shows the cost for ${inr(page.amount)}. Your exact cost, including the yearly cost (APR), is shown in the Key Fact Statement before you accept.` : 'Every charge and the yearly cost (APR) are shown in the Key Fact Statement before you accept.'],
    ['How do I get the money?', 'Apply in the LIFC app, verify yourself, accept the offer and sign the agreement. After approval, the money is sent to your own bank account. Timing depends on our checks and your bank.'],
  ];
  const desc = `${page.h1}. ${ex ? `Example: ${inr(page.amount)}, APR ${ex.apr}%. ` : ''}Apply in the LIFC app. Subject to approval.`.slice(0, 300);
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'FinancialService', name: inst.lenderName || 'LIFC', url: baseUrl },
    { '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] };
  const btn = (href, label) => (href ? `<a class="btn" href="${esc(href)}" rel="noopener">${esc(label)}</a>` : '');
  const links = [btn(config.links.android, 'Get it on Android'), btn(config.links.ios, 'Get it on iPhone'), btn(config.links.web, 'Open in your browser')].join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} | ${esc(inst.lenderName || 'LIFC')}</title>
<meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(url)}"><meta name="robots" content="index,follow">
<meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:type" content="website">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b1416;background:#faf6f6;line-height:1.55}
header{background:linear-gradient(135deg,#7b0000,#9b1b30);color:#fff;padding:18px 20px}header b{font-size:18px;letter-spacing:.04em}
main{max-width:760px;margin:0 auto;padding:24px 20px 48px;display:flex;flex-direction:column;gap:22px}
h1{font-size:clamp(24px,5vw,32px);line-height:1.2;margin:0}h2{font-size:18px;margin:0 0 8px}p{margin:0}
.card{background:#fff;border:1px solid #eadfe0;border-radius:16px;padding:18px}.muted{color:#6b7280;font-size:13px}
table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #f1e7e8}td:last-child{text-align:right;font-weight:600}tr:last-child td{border-bottom:0}
.btn{display:inline-block;background:#7b0000;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:600;margin:4px 8px 4px 0}
label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}input[type=text],input[type=tel],input[type=number]{width:100%;padding:12px;border:1px solid #eadfe0;border-radius:12px;font:inherit}
button{background:#7b0000;color:#fff;border:0;border-radius:12px;padding:13px 20px;font:inherit;font-weight:600;cursor:pointer;margin-top:12px}button:disabled{opacity:.6}
.hp{position:absolute;left:-9999px;height:0;overflow:hidden}.ok{color:#15803d;font-weight:600}.err{color:#b91c1c}
details{border-top:1px solid #f1e7e8;padding:10px 0}summary{cursor:pointer;font-weight:600}footer{font-size:12px;color:#6b7280;padding:0 20px 30px;max-width:760px;margin:0 auto}
</style></head><body>
<header><b>${esc(inst.lenderName || 'LIFC')}</b></header>
<main>
<section><h1>${esc(page.h1)}</h1><p style="margin-top:10px">${esc(page.intro)}</p><div style="margin-top:14px">${links || '<p class="muted">The app download links will be here soon.</p>'}</div></section>
${ex ? `<section class="card"><h2>A worked example</h2><table>${ex.lines.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}<tr><td>Cost per year (APR)</td><td>${esc(ex.apr)}%</td></tr></table><p class="muted" style="margin-top:10px">${esc(ex.note)}</p></section>` : ''}
<section class="card"><h2>Ask us to call you</h2><form id="f"><label for="n">Your name</label><input id="n" type="text" maxlength="60" autocomplete="name" required>
<label for="p">Mobile number</label><input id="p" type="tel" inputmode="numeric" maxlength="10" autocomplete="tel-national" required>
<label for="a">Loan amount (Rs)</label><input id="a" type="number" min="1000" value="${page.amount}">
<div class="hp" aria-hidden="true"><label for="w">Leave this empty</label><input id="w" type="text" tabindex="-1" autocomplete="off"></div>
<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400"><input id="c" type="checkbox" style="margin-top:4px"><span>${esc(CONSENT_TEXT)}</span></label>
<button id="s" type="submit">Call me</button><p id="m" class="muted" style="margin-top:10px" role="status"></p></form></section>
<section class="card"><h2>Questions</h2>${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p style="margin-top:6px">${esc(a)}</p></details>`).join('')}</section>
</main>
<footer>${esc(inst.lenderName || '')}${inst.registrationNumber ? ` · Registration no. ${esc(inst.registrationNumber)}` : ''}${inst.address ? `<br>${esc(inst.address)}` : ''}${inst.grievanceOfficerName ? `<br>Grievance officer: ${esc(inst.grievanceOfficerName)}${inst.grievanceOfficerEmail ? ' · ' + esc(inst.grievanceOfficerEmail) : ''}${inst.grievanceOfficerPhone ? ' · ' + esc(inst.grievanceOfficerPhone) : ''}` : ''}
<br>Loans are subject to eligibility and approval. The amount, rate and charges you are offered depend on your profile and are shown in the Key Fact Statement before you accept.</footer>
<script>
document.getElementById('f').addEventListener('submit', async function (e) {
  e.preventDefault();
  var m = document.getElementById('m'), s = document.getElementById('s');
  s.disabled = true; m.className = 'muted'; m.textContent = 'Sending...';
  try {
    var r = await fetch('/api/public/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('n').value, phone: document.getElementById('p').value, amount: document.getElementById('a').value, consent: document.getElementById('c').checked, website: document.getElementById('w').value, page: ${JSON.stringify(page.slug)}, kind: 'personal' }) });
    var d = await r.json().catch(function () { return {}; });
    if (r.ok) { m.className = 'ok'; m.textContent = d.message || 'Thank you. We will call you soon.'; document.getElementById('f').reset(); }
    else { m.className = 'err'; m.textContent = d.error || 'Something went wrong. Please try again.'; }
  } catch (x) { m.className = 'err'; m.textContent = 'We could not send that. Check your connection and try again.'; }
  s.disabled = false;
});
</script></body></html>`;
}

export function renderIndex({ config }, baseUrl) {
  const pages = config.pages.filter(p => p.enabled && (p.product !== 'payday' || paydaySettings().enabled));
  const inst = getPolicy().institution || {};
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Loans | ${esc(inst.lenderName || 'LIFC')}</title><link rel="canonical" href="${esc(baseUrl)}/loan"><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px 20px;color:#1b1416}a{color:#7b0000;font-weight:600}li{margin:8px 0}</style></head><body><h1>${esc(inst.lenderName || 'LIFC')} loans</h1><ul>${pages.map(p => `<li><a href="/loan/${esc(p.slug)}">${esc(p.title)}</a></li>`).join('')}</ul></body></html>`;
}

export function sitemap(config, baseUrl) {
  const urls = [`${baseUrl}/loan`, ...config.pages.filter(p => p.enabled && (p.product !== 'payday' || paydaySettings().enabled)).map(p => `${baseUrl}/loan/${p.slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export default { getConfigObj, save, validate, findPage, renderPage, renderIndex, sitemap, example };
