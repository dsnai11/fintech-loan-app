import { check, section, connect, disconnect, startServer, finish, makeAdmin, client } from '../lib.mjs';
import { evaluate, DEFAULTS, bankRiskSegment, validateRules } from '../../src/services/decisionEngine.js';
import { validateSettings, DEFAULTS as APP_DEFAULTS } from '../../src/services/appSettings.js';

const DB = 'fintech-test-moneyview-ideas';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();

section('BANK STATEMENT RISK: NO STATEMENTS, HIGHER RISK, LOWER RISK');
const ic = DEFAULTS.incomeCheck;
check('no statements is 0', bankRiskSegment(null, ic) === 0);
check('clean statements are lower risk (2)', bankRiskSegment({ estimatedMonthlyIncome: 50000, monthlyObligations: 8000, bounces: 0, avgBalance: 20000 }, ic) === 2);
check('a bounced payment makes it higher risk (1)', bankRiskSegment({ estimatedMonthlyIncome: 50000, monthlyObligations: 8000, bounces: 1, avgBalance: 20000 }, ic) === 1);
check('heavy repayments (over 40% of income) make it higher risk', bankRiskSegment({ estimatedMonthlyIncome: 50000, monthlyObligations: 25000, bounces: 0, avgBalance: 20000 }, ic) === 1);
check('a thin balance (under 25% of income) makes it higher risk', bankRiskSegment({ estimatedMonthlyIncome: 50000, monthlyObligations: 5000, bounces: 0, avgBalance: 5000 }, ic) === 1);
check('no regular salary seen is higher risk, not lower', bankRiskSegment({ estimatedMonthlyIncome: null, monthlyObligations: 0, bounces: 0, avgBalance: 90000 }, ic) === 1);
check('the lines are the lender\'s to set', bankRiskSegment({ estimatedMonthlyIncome: 50000, monthlyObligations: 25000, bounces: 0, avgBalance: 20000 }, { ...ic, riskMaxObligationShare: 60 }) === 2);
check('the lines are validated', validateRules({ ...DEFAULTS, incomeCheck: { ...DEFAULTS.incomeCheck, riskMaxObligationShare: 500 } }).errors.length === 1);
const clean = { amount: 10000, age: 32, kycApproved: true, phoneVerified: true, openAmlAlerts: 0, defaultedLoans: 0, openLoans: 0, overdueEmis: 0, repeatCustomer: false, bureauScore: 700, selfieStatus: 'passed', monthlyIncome: 50000, emi: 3000, incomeVerified: true, verifiedMonthlyIncome: 50000, bankBounces: 0, bankObligations: 0, avgBankBalance: 30000, bankRisk: 1 };
const rules = validateRules({ ...DEFAULTS, custom: [{ name: 'Higher bank risk', field: 'bankRisk', op: '=', value: 1, result: 'refer', message: 'Bank statements look higher risk' }] }).rules;
const r1 = evaluate(rules, clean);
check('staff see the segment on the application', r1.checks.find(c => c.code === 'BANK_RISK')?.result === 'skip' && /Higher risk/.test(r1.checks.find(c => c.code === 'BANK_RISK').detail));
check('it never changes the outcome by itself', evaluate(DEFAULTS, clean).outcome === 'APPROVE');
check('but a rule of your own can act on it', r1.outcome === 'REFER');
check('lower risk passes that rule', evaluate(rules, { ...clean, bankRisk: 2 }).outcome === 'APPROVE');

section('THE HOME SCREEN IS CONTROLLED FROM THE PORTAL');
const pub = await call('GET', '/app-settings');
check('the app is told the layout, with every section on by default', pub.s === 200 && pub.d.home.sections.length === 8 && pub.d.home.sections.every(s => s.enabled) && pub.d.home.whyTiles.length === 4 && pub.d.home.howSteps.length === 4, JSON.stringify(Object.keys(pub.d)));
const reordered = { ...APP_DEFAULTS, home: { sections: [{ id: 'products', enabled: true }, { id: 'help', enabled: false }, { id: 'bogus', enabled: true }, { id: 'products', enabled: false }] } };
const v = validateSettings(reordered);
check('order is kept, a hidden section stays hidden, an unknown one is dropped, a repeat is ignored', v.errors.length === 0 && v.settings.home.sections[0].id === 'products' && v.settings.home.sections[1].id === 'help' && v.settings.home.sections[1].enabled === false && !v.settings.home.sections.some(s => s.id === 'bogus') && v.settings.home.sections.filter(s => s.id === 'products').length === 1);
check('a section the list leaves out is still shown (added at the end)', v.settings.home.sections.length === 8 && v.settings.home.sections.find(s => s.id === 'loan').enabled === true);
check('an unknown icon becomes a tick', validateSettings({ ...APP_DEFAULTS, home: { whyTiles: [{ icon: 'rocket-ship', title: 'Fast', text: 'x' }] } }).settings.home.whyTiles[0].icon === 'check');
check('a tile needs a title', validateSettings({ ...APP_DEFAULTS, home: { whyTiles: [{ icon: 'star', title: '', text: 'x' }] } }).errors.length === 1);
check('no more than 6 trust tiles', validateSettings({ ...APP_DEFAULTS, home: { whyTiles: Array.from({ length: 7 }, (_, i) => ({ icon: 'star', title: `T${i}`, text: '' })) } }).errors.length === 1);
check('a title that is too long is refused', validateSettings({ ...APP_DEFAULTS, home: { whyTitle: 'x'.repeat(60) } }).errors.length === 1);
check('empty words fall back to the standard ones', validateSettings({ ...APP_DEFAULTS, home: { helpTitle: '   ' } }).settings.home.helpTitle === 'Need a hand?');

const put = await call('PUT', '/app-settings/admin', admin, { home: { sections: [{ id: 'products', enabled: true }, { id: 'how', enabled: false }], whyTitle: 'Why LIFC', whyTiles: [{ icon: 'star', title: 'Simple', text: 'No hidden charges' }], helpText: 'We are here' } });
check('staff can save a layout', put.s === 200, JSON.stringify(put.d));
const after = (await call('GET', '/app-settings')).d.home;
check('phones read it: new order, hidden section, own words and tiles', after.sections[0].id === 'products' && after.sections.find(s => s.id === 'how').enabled === false && after.whyTitle === 'Why LIFC' && after.whyTiles.length === 1 && after.whyTiles[0].title === 'Simple' && after.helpText === 'We are here');
check('words left alone keep their standard text', after.howTitle === 'How it works' && after.howSteps.length === 4);
const bad = await call('PUT', '/app-settings/admin', admin, { home: { whyTiles: [{ icon: 'star', title: '', text: '' }] } });
check('a bad layout is refused and nothing changes (400)', bad.s === 400 && (await call('GET', '/app-settings')).d.home.whyTitle === 'Why LIFC');
const reset = await call('PUT', '/app-settings/admin', admin, { home: {} });
check('"back to the standard layout" restores everything', reset.s === 200 && (await call('GET', '/app-settings')).d.home.sections.every(s => s.enabled) && (await call('GET', '/app-settings')).d.home.whyTiles.length === 4);
check('customers cannot change it (not staff)', [401, 403].includes((await call('PUT', '/app-settings/admin', null, { home: {} })).s));

srv.stop();
await disconnect();
finish();
