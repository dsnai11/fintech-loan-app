import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import AuditLog from '../../src/models/AuditLog.js';
import { chargeLines, validateCharges, stateFromPincode, BRE_PRESET } from '../../src/services/chargesEngine.js';

const DB = 'fintech-test-charges';
await connect(DB);
const srv = await startServer(DB, { REQUIRE_KYC_FOR_APPROVAL: 'false', REQUIRE_LOAN_AGREEMENT: 'false' });
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const preset = validateCharges({ enabled: true, charges: BRE_PRESET }).config;
const ctx = (amount, state = '', extra = {}) => ({ amount, tenureMonths: 3, planType: '3_emi', state, ...extra });
const total = lines => lines.reduce((t, l) => t + l.total, 0);

section('WHICH STATE A PIN CODE IS IN');
check('Gujarat, Rajasthan, Madhya Pradesh and Chhattisgarh are recognised', stateFromPincode('380001') === 'Gujarat' && stateFromPincode('302001') === 'Rajasthan' && stateFromPincode('452001') === 'Madhya Pradesh' && stateFromPincode('492001') === 'Chhattisgarh');
check('other states are not guessed', stateFromPincode('400001') === '' && stateFromPincode('abc') === '' && stateFromPincode('') === '');

section('THE CHARGES, WORKED OUT');
const other = chargeLines(preset, ctx(30000), 18);
check('file charge is 2% plus GST (600 + 108)', other.lines.find(l => l.name === 'File charge').charge === 600 && other.lines.find(l => l.name === 'File charge').gst === 108);
check('document charge of Rs 300 includes its GST (254 + 46)', (() => { const d = other.lines.find(l => l.name === 'Document verification'); return d.total === 300 && d.gst === 46 && d.charge === 254; })());
check('insurance lines have no GST', other.lines.filter(l => /accident|Wellness/.test(l.name)).every(l => l.gst === 0));
check('everything together for Rs 30,000 is Rs 3,822', total(other.lines) === 3822, String(total(other.lines)));
const guj = chargeLines(preset, ctx(30000, 'Gujarat'), 18);
check('in Gujarat the 2.5% file charge replaces the general one, not adds to it', guj.lines.filter(l => /^File charge/.test(l.name)).length === 1 && guj.lines.find(l => /^File charge/.test(l.name)).charge === 750);
const raj = chargeLines(preset, ctx(30000, 'Rajasthan'), 18);
check('Rajasthan adds the stamping charge (0.325%)', raj.lines.find(l => l.name === 'Stamping charge').total === 98);
check('no stamping charge elsewhere', !other.lines.some(l => l.name === 'Stamping charge'));
check('document charge steps up with the loan amount', chargeLines(preset, ctx(300000), 18).lines.find(l => l.name === 'Document verification').total === 600 && chargeLines(preset, ctx(600000), 18).lines.find(l => l.name === 'Document verification').total === 1000);
const opt = validateCharges({ enabled: true, charges: BRE_PRESET.map(c => (c.name === 'Wellness (insurance)' ? { ...c, optional: true } : c)) }).config;
const noPick = chargeLines(opt, ctx(30000), 18);
check('an optional charge is offered, not charged', !noPick.lines.some(l => /Wellness/.test(l.name)) && noPick.addOns.some(l => /Wellness/.test(l.name)) && total(noPick.lines) === 3822 - 1314);
check('and is charged once the customer ticks it', total(chargeLines(opt, ctx(30000), 18, ['wellness_insurance']).lines) === 3822);

section('CHECKING WHAT IS ENTERED');
const bad = validateCharges({ enabled: true, charges: [{ name: '', basis: 'fixed', amount: 5, gst: 'none' }, { name: 'X', basis: 'percent', amount: 50, gst: 'none' }, { name: 'Y', basis: 'weird', amount: 1, gst: 'none' }, { name: 'Z', basis: 'fixed', amount: 10, gst: 'maybe' }, { name: 'S', basis: 'fixed', amount: 10, gst: 'none', conditions: { states: ['Atlantis'] } }, { name: 'R', basis: 'fixed', amount: 10, gst: 'none', conditions: { amountMin: 500, amountMax: 100 } }] });
check('missing name, big percentage, bad basis, bad GST, unknown state and backwards range are all refused', bad.errors.length >= 6, JSON.stringify(bad.errors));
check('the BRE starter set is valid', validateCharges({ enabled: true, charges: BRE_PRESET }).errors.length === 0);

section('CHARGES API');
const c0 = await call('GET', '/admin/charges', admin);
check('starts switched off with no charges', c0.s === 200 && c0.d.config.enabled === false && c0.d.config.charges.length === 0 && c0.d.states.includes('Gujarat'));
check('the BRE starter set can be loaded without saving', (await call('GET', '/admin/charges/preset', admin)).d.charges.length === 8 && (await call('GET', '/admin/charges', admin)).d.config.charges.length === 0);

const hire = async (role, n) => (await call('POST', '/admin/staff', admin, { firstName: role, lastName: 'S', email: `${role}${n}@lifc.in`, phone: `96200000${n}`, role })).d.staff;
const credit = await hire('credit_officer', 1);
await User.updateMany({ role: { $nin: [null, 'customer'] } }, { twoFactorEnabled: true });
const tCredit = await tokenFor(await User.findById(credit.id), true);
const mk = async (n, zip, extra = {}) => { const u = await User.create({ firstName: `Cust${n}`, lastName: 'C', email: `c${n}@x.in`, phone: `95100000${n}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, address: { street: 'x', zipCode: zip }, ...extra }); return { u, tok: await tokenFor(u), n }; };
const guCust = await mk(1, '380001');
const maCust = await mk(2, '400001');
check('a credit officer can read the charges but not change them (403)', (await call('GET', '/admin/charges', tCredit)).s === 200 && (await call('PUT', '/admin/charges', tCredit, { enabled: true, charges: BRE_PRESET })).s === 403);
check('customers cannot (403)', (await call('GET', '/admin/charges', guCust.tok)).s === 403);
check('no login -> 401', (await call('GET', '/admin/charges', null)).s === 401);

section('SWITCHED OFF, NOTHING CHANGES');
const flat = await call('GET', '/pricing/quote?amount=30000&plan=3_emi', null);
check('the single processing fee still applies (750 + 135)', flat.d.quote.processingFee === 750 && flat.d.quote.gst === 135 && flat.d.quote.netDisbursed === 29115 && flat.d.quote.chargesMode === 'flat' && flat.d.quote.charges.length === 1);

section('SWITCHING IT ON');
const prev = await call('POST', '/admin/charges/preview', admin, { config: { enabled: true, charges: BRE_PRESET }, state: 'Gujarat' });
const row = prev.d.rows.find(r => r.amount === 30000 && /3-month/.test(r.plan));
check('the preview shows what customers would pay, before saving, with the yearly cost', prev.s === 200 && row.totalCharges === 3999 && row.netDisbursed === 26001 && row.aprPercent > 100, JSON.stringify(row));
check('and nothing was saved', (await call('GET', '/admin/charges', admin)).d.config.enabled === false);
check('a bad rule is refused (400)', (await call('PUT', '/admin/charges', admin, { enabled: true, charges: [{ name: 'X', basis: 'percent', amount: 99, gst: 'none' }] })).s === 400);
check('with an APR ceiling set, charges that break it are refused (409)', (await call('PUT', '/admin/pricing', admin, { maxAprPercent: 60 })).s === 200 && (await call('PUT', '/admin/charges', admin, { enabled: true, charges: BRE_PRESET })).s === 409);
await call('PUT', '/admin/pricing', admin, { maxAprPercent: null });
const saved = await call('PUT', '/admin/charges', admin, { enabled: true, charges: BRE_PRESET });
check('saved and switched on', saved.s === 200 && saved.d.config.enabled === true && saved.d.config.charges.length === 8, JSON.stringify(saved.d).slice(0, 150));
check('it is in the audit log', !!(await AuditLog.findOne({ action: 'CHARGES_UPDATED' })));

const q1 = (await call('GET', '/pricing/quote?amount=30000&plan=3_emi', null)).d.quote;
check('an anonymous quote uses the general charges', q1.chargesMode === 'rules' && q1.totalCharges === 3822 && q1.netDisbursed === 26178 && q1.aprPercent > 100, JSON.stringify(q1.charges.map(c => c.name)));
const q2 = (await call('GET', '/pricing/quote?amount=30000&plan=3_emi', guCust.tok)).d.quote;
check("a Gujarat customer's quote uses the Gujarat file charge, from their saved address", q2.totalCharges === 3999 && q2.netDisbursed === 26001, String(q2.totalCharges));
const q3 = (await call('GET', '/pricing/quote?amount=30000&plan=3_emi', maCust.tok)).d.quote;
check("a customer elsewhere gets the general charges", q3.totalCharges === 3822);
check('the state can be given directly', (await call('GET', '/pricing/quote?amount=30000&plan=3_emi&state=Rajasthan', null)).d.quote.totalCharges === 3822 + 98);
check('the plan list is itemised too', (await call('GET', '/pricing/quotes?amount=30000', guCust.tok)).d.quotes.every(q => q.charges.length >= 4 && q.totalCharges === q.charges.reduce((t, c) => t + c.total, 0)));
check('the totals agree: charges excluding GST plus GST equals the total', q2.processingFee + q2.gst === q2.totalCharges);
check('charges bigger than a small loan are refused (400)', (await call('PUT', '/admin/pricing', admin, { minAmount: 1000 })).s === 200 && (await call('GET', '/pricing/quote?amount=1000&plan=one_time', null)).s === 400);

section('OPTIONAL ADD-ONS');
const cfg = (await call('GET', '/admin/charges', admin)).d.config;
const withOptional = { enabled: true, charges: cfg.charges.map(c => (/accident|Wellness/.test(c.name) ? { ...c, optional: true } : c)) };
check('insurance made optional is saved', (await call('PUT', '/admin/charges', admin, withOptional)).s === 200);
const o1 = (await call('GET', '/pricing/quote?amount=30000&plan=3_emi', guCust.tok)).d.quote;
check('the quote leaves them out and offers them', o1.totalCharges === 3999 - 2814 && o1.addOns.length === 2 && o1.addOns.some(a => a.id === 'wellness_insurance'), JSON.stringify(o1.addOns.map(a => a.id)));
const o2 = (await call('GET', '/pricing/quote?amount=30000&plan=3_emi&optional=wellness_insurance', guCust.tok)).d.quote;
check('ticking one adds just that one', o2.totalCharges === 3999 - 1500 && o2.addOns.length === 1);

const apply = (c, body) => call('POST', '/loans/apply-full', c.tok, { loanAmount: 30000, tenure: 3, purpose: 'Personal', planType: '3_emi', bankDetails: { accountHolder: 'C', accountNumber: `66600000${c.n}`, ifscCode: 'SBIN0001234' }, ...body });
check('an add-on that does not exist is refused (400)', (await apply(guCust, { optionalCharges: ['nonsense'] })).s === 400);
check('a compulsory charge cannot be passed off as an add-on (400)', (await apply(guCust, { optionalCharges: ['file_charge_gujarat'] })).s === 400);
const a1 = await apply(guCust, { optionalCharges: ['wellness_insurance'] });
const l1 = await Loan.findOne({ userId: guCust.u._id });
check('the application keeps the exact charges, the add-on chosen and the state', a1.s === 201 && l1.kfs.totalCharges === 3999 - 1500 && l1.kfs.chargeState === 'Gujarat' && l1.kfs.charges.some(c => c.id === 'wellness_insurance') && !l1.kfs.charges.some(c => /accident/.test(c.name)), JSON.stringify(l1.kfs.charges.map(c => c.id)));
check('the payout is the amount after those charges', l1.disbursalDetails.disbursedAmount === 30000 - (3999 - 1500) && l1.kfs.netDisbursed === l1.disbursalDetails.disbursedAmount);
const a2 = await apply(maCust, {});
const l2 = await Loan.findOne({ userId: maCust.u._id });
check('a customer who chose nothing is not charged for add-ons', a2.s === 201 && !l2.kfs.charges.some(c => /Wellness|accident/.test(c.name)));
await call('POST', `/admin/loans/${l1._id}/approve`, admin, {});
const ag = await call('GET', `/compliance/agreement/${l1._id}`, guCust.tok);
check('the agreement lists each charge by name', ag.s === 200 && /File charge \(Gujarat\)/.test(ag.d.text) && /Document verification/.test(ag.d.text) && /Wellness/.test(ag.d.text) && !/accident/.test(ag.d.text), ag.d.text?.slice(0, 80));
check('and states the amount received', ag.d.text.includes(`Amount you receive: Rs ${Math.round(l1.kfs.netDisbursed).toLocaleString('en-IN')}`));

section('SWITCHED BACK OFF');
await call('PUT', '/admin/charges', admin, { ...withOptional, enabled: false });
const back = (await call('GET', '/pricing/quote?amount=30000&plan=3_emi', null)).d.quote;
check('the single processing fee is back', back.chargesMode === 'flat' && back.totalCharges === 885);
check('a loan already applied for keeps its charges', (await Loan.findById(l1._id)).kfs.totalCharges === 3999 - 1500);

await srv.stop();
await disconnect();
finish();
