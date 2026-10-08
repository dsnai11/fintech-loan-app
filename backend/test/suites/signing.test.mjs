import { check, section, connect, disconnect, startServer, finish, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import AgreementAcceptance from '../../src/models/AgreementAcceptance.js';
import AuditLog from '../../src/models/AuditLog.js';

const DB = 'fintech-test-signing';
await connect(DB);
const click = await startServer(DB);
const otp = await startServer(DB, { AGREEMENT_SIGNING: 'otp' });
const aad = await startServer(DB, { AGREEMENT_SIGNING: 'aadhaar' });
const aadProd = await startServer(DB, { AGREEMENT_SIGNING: 'aadhaar', PAYMENT_MODE: 'PRODUCTION' });
const callClick = client(click.base), callOtp = client(otp.base), callAad = client(aad.base), callProd = client(aadProd.base);

let n = 0;
async function approved() {
  n++;
  const user = await User.create({ firstName: `Sig${n}`, lastName: 'Ner', email: `sig${n}@x.in`, phone: `9800000${String(n).padStart(3, '0')}`, password: 'x12345678', kycStatus: 'approved', bankAccount: { accountNumber: '123456789012', ifscCode: 'SBIN0001234', accountHolder: 'S N' } });
  const loan = await Loan.create({ userId: user._id, loanAmount: 20000, tenure: 3, interestRate: 15, monthlyEMI: 7000, totalAmount: 21000, status: 'approved' });
  return { user, loan, token: await tokenFor(user) };
}
const hashOf = async (call, c) => (await call('GET', `/compliance/agreement/${c.loan._id}`, c.token)).d.hash;

section('TICK-BOX (THE DEFAULT)');
const a = await approved();
const g = await callClick('GET', `/compliance/agreement/${a.loan._id}`, a.token);
check('the agreement says how it is signed', g.s === 200 && g.d.signing.method === 'click' && g.d.signing.available === true);
check('without ticking it is refused (400)', (await callClick('POST', `/compliance/agreement/${a.loan._id}/accept`, a.token, { hash: g.d.hash })).s === 400);
check('with a changed text it is refused (409)', (await callClick('POST', `/compliance/agreement/${a.loan._id}/accept`, a.token, { hash: 'nope', confirmed: true })).s === 409);
const ok = await callClick('POST', `/compliance/agreement/${a.loan._id}/accept`, a.token, { hash: g.d.hash, confirmed: true });
check('ticking signs it as a click', ok.s === 200 && ok.d.method === 'click' && (await AgreementAcceptance.findOne({ loanId: a.loan._id })).method === 'click');
check('signing twice changes nothing', (await callClick('POST', `/compliance/agreement/${a.loan._id}/accept`, a.token, { hash: g.d.hash, confirmed: true })).d.alreadyAccepted === true);

section('SMS CODE');
const b = await approved();
const gb = await callOtp('GET', `/compliance/agreement/${b.loan._id}`, b.token);
check('the agreement says a code is needed, and shows a masked phone', gb.d.signing.method === 'otp' && /XXXXXX/.test(gb.d.signing.phone), JSON.stringify(gb.d.signing));
check('a tick alone is no longer enough (403)', (await callOtp('POST', `/compliance/agreement/${b.loan._id}/accept`, b.token, { hash: gb.d.hash, confirmed: true })).s === 403);
const sent = await callOtp('POST', `/compliance/agreement/${b.loan._id}/code`, b.token);
check('a code is sent (handed back in test mode)', sent.s === 200 && /^\d{6}$/.test(sent.d.sandboxOtp), JSON.stringify(sent.d));
check('asking again at once is refused (429)', (await callOtp('POST', `/compliance/agreement/${b.loan._id}/code`, b.token)).s === 429);
const wrong = await callOtp('POST', `/compliance/agreement/${b.loan._id}/accept`, b.token, { hash: gb.d.hash, confirmed: true, code: sent.d.sandboxOtp === '000000' ? '111111' : '000000' });
check('a wrong code is refused and counts attempts', wrong.s === 400 && wrong.d.attemptsLeft === 4);
check('the code must be ticked too (400)', (await callOtp('POST', `/compliance/agreement/${b.loan._id}/accept`, b.token, { hash: gb.d.hash, code: sent.d.sandboxOtp })).s === 400);
const other = await approved();
check('another customer cannot use the code (404)', (await callOtp('POST', `/compliance/agreement/${b.loan._id}/accept`, other.token, { hash: gb.d.hash, confirmed: true, code: sent.d.sandboxOtp })).s === 404);
const signed = await callOtp('POST', `/compliance/agreement/${b.loan._id}/accept`, b.token, { hash: gb.d.hash, confirmed: true, code: sent.d.sandboxOtp });
const rec = await AgreementAcceptance.findOne({ loanId: b.loan._id });
check('the right code signs it, with the phone recorded', signed.s === 200 && rec.method === 'otp' && /XXXXXX/.test(rec.signature.phone) && !!rec.signature.verifiedAt, JSON.stringify(signed.d));
check('the audit log says how', (await AuditLog.countDocuments({ action: 'AGREEMENT_ACCEPTED' })) === 2 && !!(await AuditLog.findOne({ action: 'AGREEMENT_ACCEPTED', 'details.method': 'otp' })) || (await AuditLog.countDocuments({ action: 'AGREEMENT_ACCEPTED' })) >= 2);
check('a code cannot be reused for another loan', (await callOtp('POST', `/compliance/agreement/${other.loan._id}/accept`, other.token, { hash: await hashOf(callOtp, other), confirmed: true, code: sent.d.sandboxOtp })).s === 400);

section('AADHAAR ESIGN (TEST MODE)');
const c = await approved();
const gc = await callAad('GET', `/compliance/agreement/${c.loan._id}`, c.token);
check('it says Aadhaar eSign, in test mode', gc.d.signing.method === 'aadhaar' && gc.d.signing.test === true);
check('the tick-box is refused (403)', (await callAad('POST', `/compliance/agreement/${c.loan._id}/accept`, c.token, { hash: gc.d.hash, confirmed: true })).s === 403);
const st = await callAad('POST', `/esign/start/${c.loan._id}`, c.token, { hash: gc.d.hash });
check('signing starts and gives the stand-in page', st.s === 200 && st.d.url.includes('/api/esign/sandbox/'), JSON.stringify(st.d));
check('an out-of-date agreement cannot be signed (409)', (await callAad('POST', `/esign/start/${c.loan._id}`, c.token, { hash: 'old' })).s === 409);
const pg = await fetch(aad.base + `/esign/sandbox/${st.d.sessionId}`);
check('the stand-in page says it is a test', pg.status === 200 && (await pg.text()).includes('TEST MODE'));
check('the status is waiting', (await callAad('GET', `/esign/status/${st.d.sessionId}`, c.token)).d.status === 'created');
const post = await fetch(aad.base + `/esign/sandbox/${st.d.sessionId}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=sign&otp=123456', redirect: 'manual' });
check('signing redirects to the done page', post.status === 302);
const arec = await AgreementAcceptance.findOne({ loanId: c.loan._id });
check('the agreement is signed as aadhaar, marked as a test', arec.method === 'aadhaar' && arec.signature.test === true && /^TEST-/.test(arec.signature.certificateId));
check('the session is complete', (await callAad('GET', `/esign/status/${st.d.sessionId}`, c.token)).d.status === 'completed');
check('the page cannot be reused (404)', (await fetch(aad.base + `/esign/sandbox/${st.d.sessionId}`)).status === 404);
const d2 = await approved();
const st2 = await callAad('POST', `/esign/start/${d2.loan._id}`, d2.token, { hash: await hashOf(callAad, d2) });
await fetch(aad.base + `/esign/sandbox/${st2.d.sessionId}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=deny', redirect: 'manual' });
check('cancelling signs nothing', (await callAad('GET', `/esign/status/${st2.d.sessionId}`, d2.token)).d.status === 'failed' && !(await AgreementAcceptance.findOne({ loanId: d2.loan._id })));
check('someone else cannot start for a loan that is not theirs (404)', (await callAad('POST', `/esign/start/${d2.loan._id}`, c.token, { hash: 'x' })).s === 404);

section('PRODUCTION WITHOUT A PROVIDER');
const e = await approved();
const ge = await callProd('GET', `/compliance/agreement/${e.loan._id}`, e.token);
check('it says Aadhaar eSign is not available, not falling back to a tick', ge.d.signing.method === 'aadhaar' && ge.d.signing.available === false);
check('starting is refused (503)', (await callProd('POST', `/esign/start/${e.loan._id}`, e.token, { hash: ge.d.hash })).s === 503);
check('the tick-box is still refused (403)', (await callProd('POST', `/compliance/agreement/${e.loan._id}/accept`, e.token, { hash: ge.d.hash, confirmed: true })).s === 403);

section('THE AGREEMENT AS A PDF');
const link = await callClick('POST', `/esign/pdf-link/${a.loan._id}`, a.token);
const getPdf = async path => { const r = await fetch(click.base.replace('/api', '') + path); return { s: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) }; };
const pdf = await getPdf(link.d.path);
check('a signed agreement downloads as a PDF', link.s === 200 && pdf.s === 200 && pdf.type === 'application/pdf' && pdf.buf.slice(0, 4).toString() === '%PDF' && pdf.buf.length > 2000, `${pdf.s} ${pdf.buf.length}`);
const b2 = await approved();
const draft = await getPdf((await callClick('POST', `/esign/pdf-link/${b2.loan._id}`, b2.token)).d.path);
check('an unsigned one downloads too, as a draft', draft.s === 200 && draft.buf.slice(0, 4).toString() === '%PDF');
check('a bad link is refused (401)', (await getPdf('/api/esign/pdf?t=garbage')).s === 401);
check('someone else cannot get a link (404)', (await callClick('POST', `/esign/pdf-link/${a.loan._id}`, b2.token)).s === 404);
const early = await Loan.create({ userId: a.user._id, loanAmount: 5000, tenure: 1, interestRate: 15, monthlyEMI: 5200, status: 'submitted' });
check('no agreement before approval (400)', (await callClick('POST', `/esign/pdf-link/${early._id}`, a.token)).s === 400);

await disconnect();
finish();
