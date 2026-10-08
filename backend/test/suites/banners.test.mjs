import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import BannerStat from '../../src/models/BannerStat.js';

const DB = 'fintech-test-banners';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();

const cust = (first, n) => User.create({ firstName: first, lastName: 'C', email: `bn${n}@x.in`, phone: `95100000${10 + n}`, password: 'x12345678', kycStatus: 'approved' });
const newbie = await cust('Asha', 1), repeat = await cust('Ravi', 2), active = await cust('Mina', 3);
const [tn, tr, ta] = await Promise.all([tokenFor(newbie), tokenFor(repeat), tokenFor(active)]);
const loan = (u, status) => Loan.create({ userId: u._id, loanAmount: 10000, tenure: 3, status, purpose: 'Personal', interestRate: 15, monthlyEMI: 3500, totalAmount: 10500 });
await loan(repeat, 'closed');
await loan(active, 'disbursed');

section('HOME CONTENT: DEFAULTS');
check('sign-in is needed (401)', (await call('GET', '/app-home', null)).s === 401);
const first = await call('GET', '/app-home', tn);
check('with nothing set up, the app gets branding and no banners', first.s === 200 && first.d.banners.length === 0 && first.d.brand.tagline && first.d.brand.trustStrip.length === 3 && first.d.brand.name, JSON.stringify(first.d).slice(0, 300));
check('the company name comes from the pricing page', first.d.brand.name === 'Laxmi India Finance Ltd.');
check('no registration line while the number is blank', first.d.brand.registration === '');

section('STAFF EDIT');
check('customers cannot edit (403)', (await call('PUT', '/app-home/admin', tn, { banners: [] })).s === 403);
check('customers cannot read the admin view (403)', (await call('GET', '/app-home/admin', tn)).s === 403);
const bad = async (banner, why) => check(why, (await call('PUT', '/app-home/admin', admin, { banners: [banner] })).s === 400);
const ok = { title: 'Hello', cta: { text: 'Go', action: 'apply' } };
await bad({ ...ok, title: '' }, 'a banner needs a headline (400)');
await bad({ ...ok, cta: { text: '', action: 'apply' } }, 'a button that does something needs text (400)');
await bad({ ...ok, cta: { text: 'Open', action: 'url', url: 'http://x.in' } }, 'a link must be https (400)');
await bad({ ...ok, cta: { text: 'Open', action: 'url', url: 'javascript:alert(1)' } }, 'a script link is refused (400)');
await bad({ ...ok, imageUrl: 'http://x.in/a.png' }, 'a picture link must be https (400)');
await bad({ ...ok, theme: 'custom', color1: 'red', color2: '#000000' }, 'custom colours must be hex (400)');
await bad({ ...ok, startsAt: '2030-01-02', endsAt: '2030-01-01' }, 'the end must be after the start (400)');
await bad({ ...ok, showCountdown: true }, 'a countdown needs an end date (400)');
await bad({ ...ok, title: 'Hi {{secret}}' }, 'an unknown placeholder is refused (400)');
check('too many banners refused (400)', (await call('PUT', '/app-home/admin', admin, { banners: Array.from({ length: 13 }, () => ok) })).s === 400);
check('a bad brand colour is refused (400)', (await call('PUT', '/app-home/admin', admin, { brand: { primaryColor: 'navy' } })).s === 400);
check('five trust points refused (400)', (await call('PUT', '/app-home/admin', admin, { brand: { trustStrip: Array.from({ length: 5 }, () => ({ icon: 'check', text: 'x' })) } })).s === 400);

const banners = [
  { id: 'all1', title: 'Hello {{name}}', subtitle: 'For everyone', theme: 'sunrise', icon: 'gift', animation: 'confetti', cta: { text: 'Apply', action: 'apply' }, audience: 'all' },
  { id: 'newonly', title: 'Welcome', theme: 'ocean', audience: 'new', cta: { text: '', action: 'none' } },
  { id: 'repeatonly', title: 'Back again', audience: 'repeat', cta: { text: 'Go', action: 'apply' } },
  { id: 'hasloan', title: 'Pay on time', audience: 'has_loan', cta: { text: 'View', action: 'loans' } },
  { id: 'off', title: 'Switched off', enabled: false, cta: { text: '', action: 'none' } },
  { id: 'future', title: 'Not yet', startsAt: day(5).toISOString(), cta: { text: '', action: 'none' } },
  { id: 'past', title: 'Over', endsAt: day(-1).toISOString(), cta: { text: '', action: 'none' } },
  { id: 'needsoffer', title: 'Your offer is {{offer}}', cta: { text: '', action: 'none' } },
  { id: 'ends', title: 'Ending soon', endsAt: day(2).toISOString(), showCountdown: true, cta: { text: '', action: 'none' } },
];
const saved = await call('PUT', '/app-home/admin', admin, { brand: { tagline: 'Fast and fair', primaryColor: '#112233', secondaryColor: '#aa0011' }, carousel: { autoplaySeconds: 6 }, banners });
check('banners and branding saved', saved.s === 200 && saved.d.home.banners.length === 9 && saved.d.home.brand.primaryColor === '#112233' && saved.d.home.carousel.autoplaySeconds === 6, JSON.stringify(saved.d).slice(0, 300));
const adminView = await call('GET', '/app-home/admin', admin);
check('staff can read it back with the counts', adminView.s === 200 && adminView.d.home.banners[0].id === 'all1' && adminView.d.stats && adminView.d.statsDays === 30);

section('WHAT EACH CUSTOMER SEES');
const ids = r => r.d.banners.map(b => b.id).join(',');
const forNew = await call('GET', '/app-home', tn);
check('a new customer sees: everyone, new-customers and the countdown one', ids(forNew) === 'all1,newonly,ends', ids(forNew));
check('the first name is filled in', forNew.d.banners[0].title === 'Hello Asha');
check('branding follows the portal', forNew.d.brand.tagline === 'Fast and fair' && forNew.d.brand.primaryColor === '#112233' && forNew.d.carousel.autoplaySeconds === 6);
const forRepeat = await call('GET', '/app-home', tr);
check('a repeat customer sees repeat banners and not new-customer ones', ids(forRepeat) === 'all1,repeatonly,ends', ids(forRepeat));
const forActive = await call('GET', '/app-home', ta);
check('a customer with a running loan sees the loan banner', ids(forActive) === 'all1,hasloan,ends', ids(forActive));
check('switched-off, not-yet-started and finished banners never show', !['off', 'future', 'past'].some(i => ids(forNew).includes(i)));
check('a banner that quotes {{offer}} is skipped when the customer has no offer', !ids(forNew).includes('needsoffer'));
const ends = forNew.d.banners.find(b => b.id === 'ends');
check('only the countdown banner carries an end time', !!ends.endsAt && !forNew.d.banners[0].endsAt);

await User.updateOne({ _id: newbie._id }, { offer: { status: 'APPROVED', amount: 45000, expiresAt: day(10), rulesKey: 'x' } });
const withOffer = await call('GET', '/app-home', tn);
check('an offer with a stale rules key does not count, so the banner stays hidden', !ids(withOffer).includes('needsoffer'));

section('VIEWS AND TAPS');
check('bad event refused (400)', (await call('POST', '/app-home/event', tn, { id: 'all1', type: 'buy' })).s === 400);
check('odd id refused (400)', (await call('POST', '/app-home/event', tn, { id: '../x', type: 'view' })).s === 400);
await call('POST', '/app-home/event', tn, { id: 'all1', type: 'view' });
await call('POST', '/app-home/event', tr, { id: 'all1', type: 'view' });
await call('POST', '/app-home/event', tr, { id: 'all1', type: 'click' });
const unknown = await call('POST', '/app-home/event', tn, { id: 'ghost', type: 'view' });
check('an unknown banner is ignored, not stored', unknown.s === 204 && (await BannerStat.countDocuments({ bannerId: 'ghost' })) === 0);
const st = (await call('GET', '/app-home/admin', admin)).d.stats.all1;
check('staff see 2 views and 1 tap', st && st.views === 2 && st.clicks === 1, JSON.stringify(st));
check('the event needs a sign-in (401)', (await call('POST', '/app-home/event', null, { id: 'all1', type: 'view' })).s === 401);

section('REGISTRATION LINE AND AUDIT');
await call('PUT', '/admin/pricing', admin, { institution: { registrationNumber: 'N-14.03333' } });
const reg = (await call('GET', '/app-home', tn)).d.brand.registration;
check('once the registration number is filled in, the app shows it', reg === 'NBFC · Reg. no. N-14.03333', reg);
const audit = await call('GET', '/admin/compliance/audit?action=APP_HOME_UPDATED', admin);
check('every change is in the audit log', audit.s === 200 && JSON.stringify(audit.d).includes('APP_HOME_UPDATED'), JSON.stringify(audit.d).slice(0, 200));

await srv.stop();
await disconnect();
finish();
