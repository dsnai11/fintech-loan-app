import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import Role from '../../src/models/Role.js';
import Notification from '../../src/models/Notification.js';
import Offer from '../../src/models/Offer.js';
import { categoryOf } from '../../src/services/pushService.js';

const DB = 'fintech-test-promo-offers';
await connect(DB);
await Role.create({ key: 'marketer', label: 'Marketer', description: 't', permissions: ['banners.edit'] });
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const mk = (n, over = {}) => User.create({ firstName: `O${n}`, lastName: 'Fer', email: `o${n}@x.in`, phone: `97400000${String(n).padStart(2, '0')}`, password: 'x12345678', kycStatus: 'approved', ...over });
const [a, b, c, d] = await Promise.all([mk(1), mk(2), mk(3), mk(4, { language: 'hi' })]);
const loan = (u, status) => Loan.create({ userId: u._id, loanAmount: 10000, tenure: 3, interestRate: 15, monthlyEMI: 3500, totalAmount: 10500, status });
await loan(b, 'disbursed');
await loan(c, 'closed');
const [ta, tb, tc, td] = await Promise.all([tokenFor(a), tokenFor(b), tokenFor(c), tokenFor(d)]);
const marketer = await User.create({ firstName: 'Mar', lastName: 'Keter', email: 'marketer@lifc.in', phone: '9750000001', password: 'x12345678', role: 'marketer', twoFactorEnabled: true });
const tm = await tokenFor(marketer, true);
await call('PUT', '/app-home/admin', admin, { languages: ['hi'] });

const titles = r => r.d.offers.map(o => o.title).join('|');
const offer = (over = {}) => ({ title: 'Festival offer', summary: 'Quick loans for the season', details: 'Longer text', terms: 'Terms apply', status: 'published', cta: { text: 'Apply now', action: 'apply' }, ...over });
const make = async (over, tok = admin) => (await call('POST', '/admin/offers', tok, offer(over))).d.offer;

section('ACCESS');
check('sign-in is needed (401)', (await call('GET', '/offers', null)).s === 401 && (await call('GET', '/admin/offers', null)).s === 401);
check('customers cannot manage offers (403)', (await call('POST', '/admin/offers', ta, offer())).s === 403 && (await call('GET', '/admin/offers', ta)).s === 403);
check('a role with the banners permission can', (await call('GET', '/admin/offers', tm)).s === 200);
check('no offers means an empty tab, not an error', (await call('GET', '/offers', ta)).d.offers.length === 0);

section('VALIDATION');
const refuse = async (over, why) => check(why, (await call('POST', '/admin/offers', admin, offer(over))).s === 400);
await refuse({ title: '' }, 'a title is needed (400)');
await refuse({ couponCode: 'a' }, 'a bad coupon code is refused (400)');
await refuse({ cta: { text: 'Open', action: 'url', url: 'http://x.in' } }, 'a link must be https (400)');
await refuse({ cta: { text: '', action: 'apply' } }, 'a button that does something needs text (400)');
await refuse({ startsAt: '2030-01-02', endsAt: '2030-01-01' }, 'the end must be after the start (400)');
await refuse({ theme: 'custom' }, 'a custom look needs both colours (400)');
await refuse({ summary: '', details: '' }, 'publishing needs some description (400)');
await refuse({ i18n: { hi: { title: 'x'.repeat(61) } } }, 'translated text has the same limits (400)');
check('a draft can be saved with little', (await call('POST', '/admin/offers', admin, { title: 'Just a title' })).s === 201);

section('WHO SEES WHAT');
const live = await make({ title: 'For everyone', featured: false });
const draft = (await call('POST', '/admin/offers', admin, offer({ title: 'Draft one', status: 'draft' }))).d.offer;
const future = await make({ title: 'Starts later', startsAt: day(3).toISOString() });
const ended = await make({ title: 'Already over', endsAt: day(-1).toISOString() });
const forNew = await make({ title: 'New only', audience: 'new' });
const forLoan = await make({ title: 'Loan only', audience: 'has_loan' });
const forRepeat = await make({ title: 'Repeat only', audience: 'repeat' });
const star = await make({ title: 'Featured one', featured: true, i18n: { hi: { title: 'खास ऑफ़र', summary: 'त्योहार के लिए', cta: 'अभी आवेदन करें' } } });
check('states are worked out: draft, scheduled, ended, live', draft.state === 'draft' && future.state === 'scheduled' && ended.state === 'ended' && live.state === 'live');
check('a new customer sees offers for everyone and for new customers, featured first, then newest', titles(await call('GET', '/offers', ta)) === 'Featured one|New only|For everyone', titles(await call('GET', '/offers', ta)));
check('a customer with a loan running sees the loan offer', titles(await call('GET', '/offers', tb)) === 'Featured one|Loan only|For everyone', titles(await call('GET', '/offers', tb)));
check('a repeat customer sees the repeat offer', titles(await call('GET', '/offers', tc)) === 'Featured one|Repeat only|For everyone', titles(await call('GET', '/offers', tc)));
const hiList = await call('GET', '/offers', td);
const hiStar = hiList.d.offers.find(o => o.id === star.id);
check('a Hindi customer sees the Hindi words where they exist, English otherwise', hiStar.title === 'खास ऑफ़र' && hiStar.cta.text === 'अभी आवेदन करें' && hiList.d.offers.find(o => o.id === live.id).title === 'For everyone', JSON.stringify(hiStar));
check('drafts, scheduled and ended offers never show', !titles(hiList).match(/Draft one|Starts later|Already over/));

section('EDITING');
const edited = await call('PUT', `/admin/offers/${live.id}`, admin, { title: 'For everyone (updated)', couponCode: 'fest50' });
check('an offer can be changed, and a coupon code is tidied up', edited.s === 200 && edited.d.offer.title.endsWith('(updated)') && edited.d.offer.couponCode === 'FEST50');
check('a bad change is refused and nothing changes (400)', (await call('PUT', `/admin/offers/${live.id}`, admin, { cta: { text: 'x', action: 'url', url: 'ftp://x' } })).s === 400 && (await Offer.findById(live.id)).cta.action === 'apply');
check('unpublishing hides it', (await call('PUT', `/admin/offers/${forRepeat.id}`, admin, { status: 'draft' })).s === 200 && !titles(await call('GET', '/offers', tc)).includes('Repeat only'));

section('TELLING CUSTOMERS');
check('a draft cannot be announced (409)', (await call('POST', `/admin/offers/${draft.id}/notify`, admin, { expectedCount: 4 })).s === 409);
const cnt = await call('GET', '/admin/offers/count?audience=new', admin);
check('the form can see how many customers a group is', cnt.d.count === 2 && cnt.d.pushAvailable === false, JSON.stringify(cnt.d));
check('a wrong number is refused, so a changed group is never messaged by surprise (409)', (await call('POST', `/admin/offers/${forNew.id}/notify`, admin, { expectedCount: 99 })).s === 409);
const sent = await call('POST', `/admin/offers/${forNew.id}/notify`, admin, { expectedCount: 2 });
check('the notification goes to the two customers with no loan', sent.s === 200 && sent.d.recipients === 2 && (await Notification.countDocuments({ type: 'OFFER' })) === 2, JSON.stringify(sent.d));
const note = await Notification.findOne({ userId: d._id, type: 'OFFER' });
check('it carries the offer, so the app can open it', String(note.data.offerId) === forNew.id && note.title === 'New only');
const bell = await call('GET', '/notifications', tb);
check('customers outside the group get nothing', !JSON.stringify(bell.d).includes('New only'));
check('announcing the same offer twice in a day is refused (409)', (await call('POST', `/admin/offers/${forNew.id}/notify`, admin, { expectedCount: 2 })).s === 409);
const stats = (await call('GET', '/admin/offers', admin)).d.offers.find(o => o.id === forNew.id);
check('the portal records when it was sent and to how many', stats.notify.recipients === 2 && !!stats.notify.sentAt);

const hiNote = await call('POST', `/admin/offers/${star.id}/notify`, admin, { expectedCount: 4 });
const hiDoc = await Notification.findOne({ userId: d._id, type: 'OFFER', 'data.offerId': star.id });
const enDoc = await Notification.findOne({ userId: a._id, type: 'OFFER', 'data.offerId': star.id });
check('each customer is told in their own language', hiNote.s === 200 && hiDoc.title === 'खास ऑफ़र' && hiDoc.message === 'त्योहार के लिए' && enDoc.title === 'Featured one');

section('NOTIFY WHEN IT GOES LIVE');
const auto = await make({ title: 'Auto announced', notify: { when: 'publish' } });
check('an offer set to announce itself does so as soon as it is saved live', (await Notification.countDocuments({ 'data.offerId': auto.id })) === 4 && (await Offer.findById(auto.id)).notify.sentAt);
await call('PUT', `/admin/offers/${auto.id}`, admin, { title: 'Auto announced again' });
check('later edits do not announce it again', (await Notification.countDocuments({ 'data.offerId': auto.id })) === 4);
const later = await make({ title: 'Announced when it starts', startsAt: day(2).toISOString(), notify: { when: 'publish' } });
check('a future offer waits and sends nothing yet', (await Notification.countDocuments({ 'data.offerId': later.id })) === 0);
await call('PUT', `/admin/offers/${later.id}`, admin, { startsAt: day(-0.01).toISOString() });
check('once it is live it is announced', (await Notification.countDocuments({ 'data.offerId': later.id })) === 4);

section('COUNTS, DELETE, AUDIT');
check('a bad event is refused (400)', (await call('POST', `/offers/${live.id}/event`, ta, { type: 'buy' })).s === 400);
await call('POST', `/offers/${live.id}/event`, ta, { type: 'view' });
await call('POST', `/offers/${live.id}/event`, tb, { type: 'view' });
await call('POST', `/offers/${live.id}/event`, tb, { type: 'click' });
const counted = (await call('GET', '/admin/offers', admin)).d.offers.find(o => o.id === live.id);
check('views and taps are counted for staff', counted.views === 2 && counted.clicks === 1);
check('an offer can be deleted', (await call('DELETE', `/admin/offers/${ended.id}`, admin)).s === 200 && (await call('DELETE', `/admin/offers/${ended.id}`, admin)).s === 404);
check('the push category for offers is the one customers can switch off', categoryOf('OFFER') === 'offers');
const audit = JSON.stringify((await call('GET', '/admin/compliance/audit?limit=200', admin)).d);
check('creating, changing, announcing and deleting are in the audit log', ['OFFER_CREATED', 'OFFER_UPDATED', 'OFFER_NOTIFIED', 'OFFER_DELETED'].every(x => audit.includes(x)));

await srv.stop();
await disconnect();
finish();
