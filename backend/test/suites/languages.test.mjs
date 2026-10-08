import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import { BUILTIN, SOURCE, LANGUAGE_CODES } from '../../src/i18n/catalogue.js';

const DB = 'fintech-test-languages';
await connect(DB);
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const asha = await User.create({ firstName: 'Asha', lastName: 'L', email: 'asha.l@x.in', phone: '9610000001', password: 'x12345678', kycStatus: 'approved' });
const ta = await tokenFor(asha);

section('THE CATALOGUE');
check('every language has the core screens translated', LANGUAGE_CODES.filter(c => c !== 'en').every(c => ['Home', 'Sign In', 'Pay now', 'Language'].every(k => BUILTIN[c][k])));
check('there is no empty or duplicated translation key', SOURCE.every(s => s.trim()) && new Set(SOURCE).size === SOURCE.length);
check('Hindi has the longer sentences too', Object.keys(BUILTIN.hi).length > Object.keys(BUILTIN.ta).length);

section('THE APP DOWNLOADS ITS WORDS');
const hi = await call('GET', '/app-home/strings?lang=hi', null);
check('Hindi words come back without signing in', hi.s === 200 && hi.d.strings['Sign In'] === 'साइन इन करें' && hi.d.version.length === 10, JSON.stringify(hi.d).slice(0, 120));
check('an unknown language is refused (400)', (await call('GET', '/app-home/strings?lang=xx', null)).s === 400);
check('English needs no translations', (await call('GET', '/app-home/strings?lang=en', null)).d.strings && Object.keys((await call('GET', '/app-home/strings?lang=en', null)).d.strings).length === 0);
const langs = await call('GET', '/app-home/languages', null);
check('only English and Hindi are offered until staff switch more on', langs.d.languages.map(l => l.code).join() === 'en,hi' && langs.d.languages[1].native === 'हिन्दी', JSON.stringify(langs.d));

section('STAFF CHANGE A WORD');
check('customers cannot read the editor (403)', (await call('GET', '/app-home/admin/strings?lang=hi', ta)).s === 403);
const rows = await call('GET', '/app-home/admin/strings?lang=hi', admin);
check('the editor lists every line with its built-in translation', rows.s === 200 && rows.d.rows.length > 150 && rows.d.rows.find(r => r.en === 'Home').builtin === 'होम', rows.d.rows?.length);
check('a line that is not in the app is refused (400)', (await call('PUT', '/app-home/admin/strings', admin, { lang: 'hi', changes: { 'Not a real line': 'x' } })).s === 400);
check('English cannot be edited (400)', (await call('PUT', '/app-home/admin/strings', admin, { lang: 'en', changes: { Home: 'x' } })).s === 400);
const v1 = hi.d.version;
const edit = await call('PUT', '/app-home/admin/strings', admin, { lang: 'hi', changes: { Home: 'मुख्य पृष्ठ' } });
check('a changed word is saved', edit.s === 200 && edit.d.rows.find(r => r.en === 'Home').value === 'मुख्य पृष्ठ');
const hi2 = await call('GET', '/app-home/strings?lang=hi', null);
check('the app now gets the new word, and the version changes so it re-downloads', hi2.d.strings.Home === 'मुख्य पृष्ठ' && hi2.d.version !== v1);
await call('PUT', '/app-home/admin/strings', admin, { lang: 'hi', changes: { Home: '' } });
check('clearing it brings back the built-in word', (await call('GET', '/app-home/strings?lang=hi', null)).d.strings.Home === 'होम');

section('LANGUAGES STAFF SWITCH ON');
check('an unknown language code is refused (400)', (await call('PUT', '/app-home/admin', admin, { languages: ['en', 'zz'] })).s === 400);
const on = await call('PUT', '/app-home/admin', admin, { languages: ['hi', 'ta'] });
check('Tamil switched on; English is always included', on.s === 200 && on.d.home.languages.join() === 'en,hi,ta', JSON.stringify(on.d.home.languages));
check('the picker lists them with their own names', (await call('GET', '/app-home/languages', null)).d.languages.map(l => l.native).join() === 'English,हिन्दी,தமிழ்');

section('BANNERS AND BRANDING IN THE CUSTOMER\'S LANGUAGE');
await call('PUT', '/app-home/admin', admin, {
  brand: { tagline: 'Money when you need it', trustStrip: [{ icon: 'receipt', text: 'Every charge shown first' }, { icon: 'lock', text: 'Secured with OTP and KYC' }], i18n: { hi: { tagline: 'ज़रूरत पर पैसा', trust: ['हर शुल्क पहले'] } } },
  banners: [
    { id: 'fest', title: 'Hello {{name}}', subtitle: 'Festival offer', badge: 'NEW', cta: { text: 'Apply now', action: 'apply' }, i18n: { hi: { title: 'नमस्ते {{name}}', subtitle: 'त्योहार ऑफ़र', cta: 'अभी आवेदन करें' } } },
    { id: 'plain', title: 'English only', cta: { text: '', action: 'none' } },
  ],
});
const en = (await call('GET', '/app-home', ta)).d;
check('English by default', en.lang === 'en' && en.banners[0].title === 'Hello Asha' && en.brand.tagline === 'Money when you need it');
const inHi = (await call('GET', '/app-home?lang=hi', ta)).d;
check('Hindi banner text, name filled in, button text and tagline translated', inHi.lang === 'hi' && inHi.banners[0].title === 'नमस्ते Asha' && inHi.banners[0].subtitle === 'त्योहार ऑफ़र' && inHi.banners[0].cta.text === 'अभी आवेदन करें' && inHi.brand.tagline === 'ज़रूरत पर पैसा', JSON.stringify(inHi.banners[0]));
check('the tag has no Hindi, so it stays English; the first trust point is translated, the others stay', inHi.banners[0].badge === 'NEW' && inHi.brand.trustStrip[0].text === 'हर शुल्क पहले' && inHi.brand.trustStrip[1].text === 'Secured with OTP and KYC');
check('a banner with no translation shows in English', inHi.banners[1].title === 'English only');
check('a language that is switched off falls back to English', (await call('GET', '/app-home?lang=mr', ta)).d.lang === 'en');

section('THE CUSTOMER\'S CHOICE IS REMEMBERED');
check('an unknown language is refused (400)', (await call('PUT', '/users/language', ta, { language: 'xx' })).s === 400);
check('no sign-in is refused (401)', (await call('PUT', '/users/language', null, { language: 'hi' })).s === 401);
check('the choice is saved', (await call('PUT', '/users/language', ta, { language: 'hi' })).s === 200 && (await User.findById(asha._id)).language === 'hi');
check('and the home content then follows it without being asked', (await call('GET', '/app-home', ta)).d.lang === 'hi');
const bad = await call('PUT', '/app-home/admin', admin, { banners: [{ id: 'x', title: 'Hi', cta: { text: '', action: 'none' }, i18n: { hi: { title: 'x'.repeat(61) } } }] });
check('translated text has the same length limits (400)', bad.s === 400);

await srv.stop();
await disconnect();
finish();
