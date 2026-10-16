import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import LocationEvent from '../../src/models/LocationEvent.js';
import { DEFAULTS, evaluate, validateRules, gatherFacts, SUGGESTED_START, historyScoreOf, identityMismatchesOf } from '../../src/services/decisionEngine.js';

const DB = 'fintech-test-location-rules';
await connect(DB);

const clean = { amount: 10000, age: 32, kycApproved: true, phoneVerified: true, openAmlAlerts: 0, defaultedLoans: 0, openLoans: 0, overdueEmis: 0, repeatCustomer: false, bureauScore: 720, selfieStatus: 'passed', monthlyIncome: 40000, emi: 3500 };
const rulesWith = over => validateRules({ ...DEFAULTS, ...over });
const run = (over, facts) => evaluate(rulesWith(over).rules, { ...clean, ...facts });
const code = (r, c) => r.checks.find(x => x.code === c);

section('NEW RULES ARE OFF UNTIL SWITCHED ON');
const off = evaluate(DEFAULTS, { ...clean, locationKnown: false, accountsAtPlace: 9, identityMismatches: ['x'], historyScore: 5 });
check('with the defaults, none of them changes a decision', off.outcome === 'APPROVE' && !code(off, 'LOCATION') && !code(off, 'OWN_DOCUMENT') && !code(off, 'HISTORY_SCORE'));
check('the suggested starting values are valid', validateRules({ ...DEFAULTS, ...SUGGESTED_START }).errors.length === 0);
check('the suggested start blocks Jammu and Kashmir, and the pincodes there', SUGGESTED_START.serviceArea.blockedStates.includes('Jammu and Kashmir') && SUGGESTED_START.serviceArea.blockedPincodes.includes('190'));

section('VALIDATION');
const bad = (over, why) => check(why, rulesWith(over).errors.length > 0);
bad({ location: { enabled: true, maxOtherAccounts: 3, rejectAtOtherAccounts: 2 } }, 'rejecting at fewer customers than the number allowed is refused');
bad({ location: { enabled: true, days: 0 } }, 'zero days to look back is refused');
bad({ historyScore: { enabled: true, referBelow: 50, rejectBelow: 60 } }, 'rejecting above the score that refers is refused');
bad({ historyScore: { enabled: true, referBelow: 150 } }, 'a score above 100 is refused');

section('WHERE THE CUSTOMER APPLIED FROM');
const loc = { location: { enabled: true, requireLocation: true, referOnMocked: true, maxOtherAccounts: 1, days: 7, rejectAtOtherAccounts: 4 } };
check('no location shared sends to a person', code(run(loc, { locationKnown: false }), 'LOCATION').result === 'refer');
check('unless a location is not required', code(run({ location: { ...loc.location, requireLocation: false } }, { locationKnown: false }), 'LOCATION').result === 'skip');
check('a faked location sends to a person', code(run(loc, { locationKnown: true, locationMocked: true, accountsAtPlace: 0 }), 'LOCATION').result === 'refer');
check('a real location with nobody else there passes', code(run(loc, { locationKnown: true, locationMocked: false, accountsAtPlace: 0 }), 'LOCATION').result === 'pass');
check('one other customer at the same place is allowed', code(run(loc, { locationKnown: true, accountsAtPlace: 1 }), 'LOCATION').result === 'pass');
const two = run(loc, { locationKnown: true, accountsAtPlace: 2 });
check('two others means no automatic approval, and says why', two.outcome === 'REFER' && /2 other customer/.test(code(two, 'LOCATION').detail));
check('four others rejects', run(loc, { locationKnown: true, accountsAtPlace: 4 }).outcome === 'REJECT');

section('THE DOCUMENTS MUST BE THEIR OWN');
const od = { ownDocument: { enabled: true } };
check('nothing wrong passes', code(run(od, { identityMismatches: [] }), 'OWN_DOCUMENT').result === 'pass');
const mm = run(od, { identityMismatches: ['Name on Aadhaar differs from the account', 'PAN is on another account'] });
check('any mismatch sends to a person and lists them all', mm.outcome === 'REFER' && /Name on Aadhaar/.test(code(mm, 'OWN_DOCUMENT').detail) && /PAN is on another/.test(code(mm, 'OWN_DOCUMENT').detail));
const user = o => ({ kycDigilocker: { flags: [] }, ...o });
check('the mismatches are worked out from everything we hold', identityMismatchesOf(user({ kycDigilocker: { flags: ['name_differs', 'pan_on_another_account', 'no_date_of_birth'] }, bankVerification: { status: 'name_mismatch', current: true }, aadhaarCard: { flag: 'same_photo_on_another_account', faceMatch: { result: 'no_match' }, documentCheck: { numberMatchesDigilocker: false } }, selfie: { flag: 'same_photo_on_another_account' } })).length === 7);
check('and a clean customer has none', identityMismatchesOf(user({ aadhaarCard: { faceMatch: { result: 'match' }, documentCheck: { numberMatchesDigilocker: true } } })).length === 0);

section('HOW THEY HAVE PAID US BEFORE');
const d = n => new Date(Date.now() + n * 864e5);
const emi = (due, status, paid) => ({ dueDate: d(due), status, paidDate: paid === undefined ? undefined : d(paid) });
check('no instalments gives no score', historyScoreOf([], []) === null && historyScoreOf([emi(10, 'PENDING')], []) === null);
check('all on time is 100', historyScoreOf([emi(-60, 'PAID', -60), emi(-30, 'PAID', -31)], []) === 100);
check('paying a day or two late still counts as on time', historyScoreOf([emi(-30, 'PAID', -29)], []) === 100);
check('paying a week late does not', historyScoreOf([emi(-30, 'PAID', -23)], []) < 100);
check('an instalment overdue now lowers it', historyScoreOf([emi(-60, 'PAID', -60), emi(-20, 'OVERDUE')], []) < 60);
check('a default lowers it a lot', historyScoreOf([emi(-60, 'PAID', -60)], [{ status: 'defaulted' }]) <= 60);
check('closed loans add a little, up to a cap', historyScoreOf([emi(-60, 'PAID', -60), emi(-30, 'OVERDUE')], [{ status: 'closed' }, { status: 'closed' }, { status: 'closed' }, { status: 'closed' }]) > historyScoreOf([emi(-60, 'PAID', -60), emi(-30, 'OVERDUE')], []));
check('the score stays between 0 and 100', historyScoreOf([emi(-100, 'OVERDUE')], [{ status: 'defaulted' }, { status: 'defaulted' }]) === 0);
const hs = { historyScore: { enabled: true, referBelow: 60, rejectBelow: 20 } };
check('a good score passes', code(run(hs, { historyScore: 85 }), 'HISTORY_SCORE').result === 'pass');
check('a middling score sends to a person', code(run(hs, { historyScore: 45 }), 'HISTORY_SCORE').result === 'refer');
check('a very low score rejects', run(hs, { historyScore: 10 }).outcome === 'REJECT');
check('a new customer is skipped, not punished', code(run(hs, { historyScore: null }), 'HISTORY_SCORE').result === 'skip');

section('PLACES WE DO NOT LEND (THE SUGGESTED START)');
const area = rulesWith({ serviceArea: SUGGESTED_START.serviceArea }).rules;
check('a Jammu and Kashmir address is rejected', evaluate(area, { ...clean, state: 'Jammu and Kashmir', pincode: '180001' }).outcome === 'REJECT');
check('so is a Kashmir pincode with the state left out', evaluate(area, { ...clean, state: '', pincode: '190001' }).outcome === 'REJECT');
check('Ladakh is rejected', evaluate(area, { ...clean, state: 'Ladakh', pincode: '194101' }).outcome === 'REJECT');
check('other places are fine', evaluate(area, { ...clean, state: 'Maharashtra', pincode: '411001' }).outcome === 'APPROVE');

section('THE FACTS COME FROM THE DATABASE, AND THE APP CAN SEND A LOCATION');
const srv = await startServer(DB, {});
const call = client(srv.base);
const { token: admin } = await makeAdmin();
let n = 0;
const mk = async () => {
  n++;
  const u = await User.create({ firstName: `L${n}`, lastName: 'R', email: `lr${n}@x.in`, phone: `96${String(n).padStart(8, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, dateOfBirth: new Date(Date.now() - 32 * 365.25 * 864e5), employment: { status: 'Employed', monthlyIncome: 50000 } });
  return { u, tok: await tokenFor(u) };
};
const a = await mk(), b = await mk(), c = await mk(), far = await mk();
check('no login -> 401', (await call('POST', '/location', null, { lat: 18.5, lon: 73.8 })).s === 401);
check('a location outside the world is refused (400)', (await call('POST', '/location', a.tok, { lat: 95, lon: 73.8 })).s === 400 && (await call('POST', '/location', a.tok, { lat: 'x', lon: 73.8 })).s === 400);
check('a location of exactly 0,0 (a phone that has none) is refused (400)', (await call('POST', '/location', a.tok, { lat: 0, lon: 0 })).s === 400);
check('a good location is saved', (await call('POST', '/location', a.tok, { lat: 18.52043, lon: 73.85674, accuracy: 12, purpose: 'apply' })).s === 200 && (await LocationEvent.countDocuments({ userId: a.u._id })) === 1);
check('and kept on the account as the last place', (await User.findById(a.u._id)).lastLocation.lat === 18.52043);
check('a made-up purpose is stored as other', (await call('POST', '/location', b.tok, { lat: 18.5206, lon: 73.8568, purpose: 'hack' })).s === 200 && (await LocationEvent.findOne({ userId: b.u._id })).purpose === 'other');
await call('POST', '/location', c.tok, { lat: 18.5203, lon: 73.8566, purpose: 'apply', mocked: true });
await call('POST', '/location', far.tok, { lat: 19.0760, lon: 72.8777, purpose: 'apply' });
const rules = rulesWith({ location: loc.location }).rules;
const loanFor = async x => Loan.create({ userId: x.u._id, loanAmount: 10000, tenure: 3, interestRate: 15, monthlyEMI: 3500, totalAmount: 10500, status: 'submitted' });
const facts = async x => gatherFacts(await loanFor(x), await User.findById(x.u._id), rules);
const fa = await facts(a);
check('two other customers within 100 m are counted', fa.locationKnown === true && fa.accountsAtPlace === 2 && fa.locationMocked === false, JSON.stringify(fa));
check('a customer in another city has nobody around', (await facts(far)).accountsAtPlace === 0);
check('a faked location is passed on', (await facts(c)).locationMocked === true);
check('an old location is not used', await (async () => { await LocationEvent.updateMany({ userId: far.u._id }, { at: new Date(Date.now() - 3 * 3600 * 1000) }); return (await facts(far)).locationKnown === false; })());
check('with the rule off, none of this is looked up', (await gatherFacts(await loanFor(a), await User.findById(a.u._id), DEFAULTS)).accountsAtPlace === 0);

section('WHAT STAFF SEE');
const view = await call('GET', `/admin/customers/${a.u._id}`, admin);
check('the customer page lists where the phone has been', view.s === 200 && view.d.customer.locations.length === 1 && view.d.customer.locations[0].lat === 18.52043);
check('and how they have paid, and any document problems', view.d.customer.paymentHistory.score === null && Array.isArray(view.d.customer.documentChecks));

await srv.stop();
await disconnect();
finish();
