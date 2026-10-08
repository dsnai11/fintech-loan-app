import http from 'node:http';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client, day } from '../lib.mjs';
import User from '../../src/models/User.js';
import Loan from '../../src/models/Loan.js';
import EMIPayment from '../../src/models/EMIPayment.js';
import SupportThread from '../../src/models/SupportThread.js';

const DB = 'fintech-test-assistant';
await connect(DB);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(80); } return false; };

// A pretend AI provider
const calls = [];
let mode = 'answer'; // answer | handover | junk | down
const ai = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => (body += d));
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    calls.push({ key: req.headers['x-api-key'], version: req.headers['anthropic-version'], body: j });
    if (mode === 'down') { res.writeHead(500); return res.end('{}'); }
    if (mode === 'unauth') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); }
    const text = mode === 'junk' ? 'Sorry, I cannot do that' : mode === 'handover' ? JSON.stringify({ reply: 'Let me get a colleague.', handover: true }) : `Sure! ${JSON.stringify({ reply: 'Your next instalment is due on the date shown in My Loans.', handover: false })}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
  });
});
await new Promise(r => ai.listen(0, r));
const aiBase = `http://127.0.0.1:${ai.address().port}`;

const mk = (n, over = {}) => User.create({ firstName: `A${n}`, lastName: 'Sist', email: `a${n}@x.in`, phone: `97700000${String(n).padStart(2, '0')}`, password: 'x12345678', kycStatus: 'approved', panNumber: `ABCPE${3000 + n}F`, bankAccount: { accountHolder: 'Secret Holder', accountNumber: '998877665544', ifscCode: 'SBIN0001234' }, ...over });
const [u1, u2, u3] = await Promise.all([mk(1), mk(2), mk(3, { language: 'hi' })]);
const [t1, t2, t3] = await Promise.all([tokenFor(u1), tokenFor(u2), tokenFor(u3)]);

// ── Without an AI provider ───────────────────────────────────────────────────────────────────
const srv = await startServer(DB);
const call = client(srv.base);
const { token: admin } = await makeAdmin();
const say = (tok, text) => call('POST', '/support/messages', tok, { text });
const thread = async tok => (await call('GET', '/support/thread', tok)).d.thread;
const lastBot = async tok => { const t = await thread(tok); return t && t.messages[t.messages.length - 1]; };
const waitBot = async (tok, n) => until(async () => ((await thread(tok))?.messages || []).filter(m => m.from === 'bot').length >= n);

section('THE ASSISTANT IS OFF BY DEFAULT');
check('customers are told it is off', (await call('GET', '/support/assistant', t1)).d.enabled === false);
await say(t1, 'How do I pay my EMI?');
await sleep(500);
check('with it off, a message just waits for staff, as before', (await thread(t1)).messages.length === 1 && (await SupportThread.findOne({ userId: u1._id })).lastFrom === 'customer');

section('STAFF SET IT UP');
check('customers cannot change it (403)', (await call('PUT', '/admin/assistant', t1, { enabled: true })).s === 403 && (await call('GET', '/admin/assistant', t1)).s === 403);
const state = await call('GET', '/admin/assistant', admin);
check('the starting FAQ list is there and the mode is FAQ-only', state.d.settings.kb.length >= 15 && state.d.status.mode === 'faq', JSON.stringify(state.d.status));
check('an empty name is refused (400)', (await call('PUT', '/admin/assistant', admin, { name: '' })).s === 400);
check('a FAQ without an answer is refused (400)', (await call('PUT', '/admin/assistant', admin, { kb: [{ question: 'Q?', answer: '' }] })).s === 400);
check('too many turns is refused (400)', (await call('PUT', '/admin/assistant', admin, { maxTurns: 99 })).s === 400);
const on = await call('PUT', '/admin/assistant', admin, { enabled: true, maxTurns: 3 });
check('it is switched on', on.s === 200 && on.d.settings.enabled && on.d.settings.maxTurns === 3);
const info = (await call('GET', '/support/assistant', t1)).d;
check('customers now see its name and greeting', info.enabled && info.name === 'LIFC Assistant' && /AI assistant/.test(info.greeting));
const tryIt = await call('POST', '/admin/assistant/test', admin, { question: 'how do i pay my emi' });
check('staff can try a question; it answers from the FAQ and saves nothing', tryIt.s === 200 && tryIt.d.mode === 'faq' && /My Loans/.test(tryIt.d.reply) && (await SupportThread.countDocuments()) === 1);

section('FAQ MODE: ANSWERS WHEN IT KNOWS, HANDS OVER WHEN IT DOES NOT');
await say(t2, 'How do I pay my EMI?');
check('a customer question is answered from the FAQ', await waitBot(t2, 1));
let m = await lastBot(t2);
check('the answer is labelled as the AI assistant, and the conversation is not waiting for staff', m.ai === true && m.name === 'LIFC Assistant' && /My Loans/.test(m.text) && (await SupportThread.findOne({ userId: u2._id })).lastFrom === 'bot');
await say(t2, 'hello');
await waitBot(t2, 2);
check('a greeting gets a friendly reply, not a hand-over', /Hello A2/.test((await lastBot(t2)).text) && (await thread(t2)).botActive === true);
await say(t2, 'purple monkey dishwasher');
await waitBot(t2, 3);
const threadAfter = await SupportThread.findOne({ userId: u2._id });
check('a question it cannot answer is handed to staff, and says so', threadAfter.bot.active === false && threadAfter.lastFrom === 'customer' && /passed your message to our team/.test(threadAfter.messages[threadAfter.messages.length - 1].text) && /No FAQ answer/.test(threadAfter.bot.handoverReason), JSON.stringify(threadAfter.bot));
const inbox = await call('GET', '/admin/support?view=waiting', admin);
check('the staff inbox shows it waiting, with the reason', inbox.d.threads.some(t => t.botActive === false && /No FAQ answer/.test(t.handoverReason)));
const staffView = await call('GET', `/admin/support/${threadAfter._id}`, admin);
check('staff see the assistant\'s messages marked as AI', staffView.d.messages.some(x => x.from === 'bot' && /\(AI\)/.test(x.name)));
const before = (await SupportThread.findOne({ userId: u2._id })).messages.length;
await say(t2, 'how do I pay my emi');
await sleep(700);
check('after the hand-over the assistant stays out of it', (await SupportThread.findOne({ userId: u2._id })).messages.length === before + 1);

section('SENSITIVE SUBJECTS AND "TALK TO A PERSON"');
for (const [who, tok, text] of [[u1, t1, 'I want to make a complaint, I was cheated'], [u3, t3, 'someone did fraud with my account']]) {
  await SupportThread.deleteMany({ userId: who._id });
  await say(tok, text);
  await waitBot(tok, 1);
  const th = await SupportThread.findOne({ userId: who._id });
  check(`"${text.slice(0, 28)}..." goes straight to a person`, th.bot.active === false && /sensitive/i.test(th.bot.handoverReason));
}
await SupportThread.deleteMany({ userId: u1._id });
await say(t1, 'can I talk to a human please');
await waitBot(t1, 1);
check('asking for a human is respected', (await SupportThread.findOne({ userId: u1._id })).bot.active === false);
await SupportThread.deleteMany({ userId: u1._id });
await say(t1, 'how do I pay my emi');
await waitBot(t1, 1);
const hv = await call('POST', '/support/handover', t1, {});
check('the Talk to a person button hands over and tells staff it is waiting', hv.s === 201 && hv.d.thread.botActive === false && (await SupportThread.findOne({ userId: u1._id })).lastFrom === 'customer' && /connect me to a person/.test((await SupportThread.findOne({ userId: u1._id })).messages.filter(x => x.from === 'customer').pop().text));
check('pressing it twice does not pile up messages', (await call('POST', '/support/handover', t1, {})).s === 200 && (await SupportThread.findOne({ userId: u1._id })).messages.filter(x => /connect me/.test(x.text)).length === 1);

section('A PERSON JOINING STOPS THE ASSISTANT');
await SupportThread.deleteMany({ userId: u1._id });
await say(t1, 'how do I pay my emi');
await waitBot(t1, 1);
const th1 = await SupportThread.findOne({ userId: u1._id });
await call('POST', `/admin/support/${th1._id}/reply`, admin, { text: 'Hi, this is the team.' });
const n1 = (await SupportThread.findOne({ userId: u1._id })).messages.length;
await say(t1, 'how do I pay my emi again');
await sleep(700);
check('once staff reply, further messages are left for staff', (await SupportThread.findOne({ userId: u1._id })).messages.length === n1 + 1 && (await SupportThread.findOne({ userId: u1._id })).bot.active === false);

section('THE LIMIT PER CONVERSATION');
await SupportThread.deleteMany({ userId: u3._id });
for (let i = 0; i < 4; i++) { await say(t3, 'hello'); await waitBot(t3, i + 1); }
const lim = await SupportThread.findOne({ userId: u3._id });
check('after the set number of answers (3) a person takes over', lim.bot.active === false && /limit/.test(lim.bot.handoverReason), JSON.stringify(lim.bot));

section('GOING BACK TO THE ASSISTANT');
await SupportThread.deleteMany({ userId: u1._id });
await say(t1, 'how do I pay my emi');
await waitBot(t1, 1);
await call('POST', '/support/handover', t1, {});
check('after Talk to a person the assistant steps back', (await thread(t1)).botActive === false);
await say(t1, 'how do I apply for a loan');
await sleep(500);
const waiting = await thread(t1);
check('and a new message waits for staff', waiting.messages[waiting.messages.length - 1].from === 'customer');
const back = await call('POST', '/support/resume', t1, {});
check('before staff reply, the customer can go back to the assistant', back.s === 200 && back.d.thread.botActive === true);
await until(async () => { const t = await thread(t1); return t.messages[t.messages.length - 1].from === 'bot'; });
check('and it answers the question that was waiting', /Home tab/.test((await lastBot(t1)).text), (await lastBot(t1)).text);
const thr = await SupportThread.findOne({ userId: u1._id });
await call('POST', `/admin/support/${thr._id}/reply`, admin, { text: 'Team here' });
const refused = await call('POST', '/support/resume', t1, {});
check('once a person has replied, going back is refused (409)', refused.s === 409 && /already helping/.test(refused.d.error), JSON.stringify(refused.d));
check('resume with no conversation is harmless', (await call('POST', '/support/resume', t3, {})).s === 200);

section('THE QUESTIONS CUSTOMERS CAN TAP');
const faqInfo = (await call('GET', '/support/assistant', t2)).d;
check('customers are given every FAQ question to tap, with no answers in the list', faqInfo.faqs.length >= 15 && faqInfo.faqs.every(f => f.id && f.question && !('answer' in f)), JSON.stringify(faqInfo.faqs.slice(0, 2)));
await SupportThread.deleteMany({ userId: u2._id });
await call('POST', '/support/messages', t2, { text: 'zzz xqv unreadable words', faqId: 'offers' });
await waitBot(t2, 1);
check('tapping a question gives exactly that FAQ answer, whatever the words were', /Offers tab/.test((await lastBot(t2)).text) && (await SupportThread.findOne({ userId: u2._id })).bot.active === true);
await SupportThread.deleteMany({ userId: u2._id });
await call('POST', '/support/messages', t2, { text: 'zzz xqv unreadable words', faqId: 'not-a-real-faq' });
await waitBot(t2, 1);
check('an invented question id is ignored, so it is treated as an ordinary message', (await SupportThread.findOne({ userId: u2._id })).bot.active === false);
await call('PUT', '/admin/assistant', admin, { enabled: false });
check('with the assistant off, no questions are offered', (await call('GET', '/support/assistant', t2)).d.faqs.length === 0);
await call('PUT', '/admin/assistant', admin, { enabled: true });

section('THUMBS UP AND DOWN');
const th2 = await thread(t2);
const botMsg = th2.messages.find(x => x.from === 'bot');
check('the customer can rate an answer', (await call('POST', `/support/messages/${botMsg.id}/feedback`, t2, { value: 'up' })).s === 200 && (await thread(t2)).messages.find(x => x.id === botMsg.id).feedback === 'up');
check('a bad value is refused (400)', (await call('POST', `/support/messages/${botMsg.id}/feedback`, t2, { value: 'meh' })).s === 400);
check('you cannot rate someone else\'s conversation (404)', (await call('POST', `/support/messages/${botMsg.id}/feedback`, t1, { value: 'down' })).s === 404);
const ownMsg = th2.messages.find(x => x.from === 'customer');
check('only the assistant\'s answers can be rated (400)', (await call('POST', `/support/messages/${ownMsg.id}/feedback`, t2, { value: 'up' })).s === 400);
const st = (await call('GET', '/admin/assistant', admin)).d.stats;
check('staff see how it is doing: answers, hand-overs and thumbs', st.answers >= 5 && st.handedOver >= 2 && st.thumbsUp === 1 && st.conversations >= 3, JSON.stringify(st));
await srv.stop();

// ── With an AI provider ───────────────────────────────────────────────────────────────────────
section('WITH AN AI PROVIDER CONNECTED');
const srv2 = await startServer(DB, { ASSISTANT_PROVIDER: 'anthropic', ASSISTANT_API_KEY: 'sk-test-123', ASSISTANT_API_BASE: aiBase, ASSISTANT_TIMEOUT_MS: '2000' });
const call2 = client(srv2.base);
const say2 = (tok, text) => call2('POST', '/support/messages', tok, { text });
const waitBot2 = async (tok, n) => until(async () => (((await call2('GET', '/support/thread', tok)).d.thread || {}).messages || []).filter(m => m.from === 'bot').length >= n);
const status2 = await call2('GET', '/admin/integrations', admin);
check('the Integrations page shows the assistant as live', status2.d.integrations.find(i => i.id === 'assistant').status.mode === 'live' && !JSON.stringify(status2.d).includes('sk-test-123'));
await call2('PUT', '/admin/assistant', admin, { enabled: true, maxTurns: 10 });

// a customer with a loan and an overdue instalment, so there are facts to share
const loan = await Loan.create({ userId: u2._id, loanAmount: 20000, tenure: 3, interestRate: 15, monthlyEMI: 7000, totalAmount: 21000, status: 'disbursed' });
await EMIPayment.create({ loanId: loan._id, userId: u2._id, emiNumber: 1, dueDate: day(-5), amount: 7000, principalAmount: 6500, status: 'OVERDUE' });
await SupportThread.deleteMany({});
check('the setting for questions outside the FAQ is "general" unless changed', (await call2('GET', '/admin/assistant', admin)).d.settings.outsideFaq === 'general');
await SupportThread.deleteMany({});
await say2(t2, 'What is a credit score and why does it matter?');
check('a question that is not in the FAQ list is sent to the AI', await waitBot2(t2, 1));
const gen = calls[calls.length - 1];
check('the AI is told it may use general knowledge, but only for things that do not depend on the company', /general knowledge/.test(gen.body.system) && /does not depend on this company|do not depend on this company/.test(gen.body.system) && /ONLY the KNOWLEDGE and CUSTOMER FACTS/.test(gen.body.system), gen.body.system.slice(0, 400));
check('and it is still forbidden from stating the company\'s own rates, charges or limits', /Never promise or hint/.test(gen.body.system) && /never state interest rates, charges, limits or dates that are not in the facts/.test(gen.body.system));
check('the answer is posted and recorded as AI-made', (await SupportThread.findOne({ userId: u2._id })).messages.find(x => x.from === 'bot').meta.mode === 'ai');
await call2('PUT', '/admin/assistant', admin, { outsideFaq: 'handover' });
await SupportThread.deleteMany({});
await say2(t2, 'What is a credit score and why does it matter?');
await waitBot2(t2, 1);
const strict = calls[calls.length - 1];
check('switched to "pass to my team", the AI is told to answer only from the FAQ and the facts', /Answer ONLY from the KNOWLEDGE/.test(strict.body.system) && !/general knowledge/.test(strict.body.system));
await call2('PUT', '/admin/assistant', admin, { outsideFaq: 'general' });
await SupportThread.deleteMany({});
await say2(t2, 'When is my next installment due and how much?');
check('the AI writes the answer', await waitBot2(t2, 1));
const sent = calls[calls.length - 1];
const prompt = sent.body.messages[0].content + sent.body.system;
check('it called the provider with the key and the right version', sent.key === 'sk-test-123' && sent.version === '2023-06-01' && sent.body.model === 'claude-haiku-5-5');
check('the prompt carries the FAQ, the rules and the customer\'s loan facts', /How do I pay my EMI/.test(prompt) && /Rs 7,000/.test(prompt) && /OVERDUE/.test(prompt) && /Never promise/.test(sent.body.system) && /AI assistant/.test(sent.body.system));
check('and never the PAN, bank account, phone or email', !/ABCPE3002F|998877665544|Secret Holder|97700000|a2@x\.in/.test(prompt), 'leak check');
const botText = ((await call2('GET', '/support/thread', t2)).d.thread.messages.find(x => x.from === 'bot') || {}).text;
check('the reply the customer sees is the text the AI wrote', /next instalment is due/.test(botText));
check('the answer is recorded as AI-made', (await SupportThread.findOne({ userId: u2._id })).messages.find(x => x.from === 'bot').meta.mode === 'ai');

await SupportThread.deleteMany({});
mode = 'handover';
await say2(t2, 'Can you waive my late fee?');
await waitBot2(t2, 1);
const hth = await SupportThread.findOne({ userId: u2._id });
check('when the AI says it is unsure, a person takes over', hth.bot.active === false && hth.lastFrom === 'customer' && /not sure/.test(hth.bot.handoverReason));

await SupportThread.deleteMany({});
mode = 'junk';
await say2(t2, 'What are my options for my loan?');
await waitBot2(t2, 1);
check('a reply the system cannot read is a hand-over, never shown to the customer', (await SupportThread.findOne({ userId: u2._id })).bot.active === false && !/cannot do that/.test(JSON.stringify((await SupportThread.findOne({ userId: u2._id })).messages)));

await SupportThread.deleteMany({});
mode = 'down';
await say2(t2, 'What are my options for my loan?');
await waitBot2(t2, 1);
check('if the provider is down, a person takes over; nothing is made up', (await SupportThread.findOne({ userId: u2._id })).bot.active === false && /provider failed/.test((await SupportThread.findOne({ userId: u2._id })).bot.handoverReason));

await SupportThread.deleteMany({});
mode = 'answer';
const callsBefore = calls.length;
await say2(t2, 'I want to complain about a wrong charge');
await waitBot2(t2, 1);
check('sensitive messages never even reach the provider', calls.length === callsBefore);

mode = 'unauth';
await SupportThread.deleteMany({});
await say2(t2, 'What is a credit score?');
await waitBot2(t2, 1);
check('when the provider rejects the key, the reason shows the provider own words', /answered 401 \(invalid x-api-key\)/.test((await SupportThread.findOne({ userId: u2._id })).bot.handoverReason), (await SupportThread.findOne({ userId: u2._id })).bot.handoverReason);
const bad = await call2('GET', '/admin/assistant/check', admin);
const badAccepts = bad.d.checks.find(c => /accepts the key/.test(c.name));
check('the connection check says the key was not accepted, with advice', bad.d.ok === false && badAccepts.ok === false && /401/.test(badAccepts.detail) && /console\.anthropic\.com/.test(badAccepts.detail), JSON.stringify(bad.d.checks));
check('it also notices a key that does not look like an Anthropic key, without showing the key', bad.d.checks.some(c => /looks like an Anthropic API key/.test(c.name) && c.ok === false) && !JSON.stringify(bad.d).includes('sk-test-123'), JSON.stringify(bad.d.checks.map(c => c.detail)));
check('customers cannot run the check (403)', (await call2('GET', '/admin/assistant/check', t2)).s === 403);
mode = 'answer';
const good = await call2('GET', '/admin/assistant/check', admin);
check('with a working provider the connection step passes', good.d.checks.find(c => /accepts the key/.test(c.name)).ok === true);

const aiTry = await call2('POST', '/admin/assistant/test', admin, { question: 'What documents do I need?', language: 'hi' });
check('the portal test uses the provider but shares no customer details, and asks for the customer\'s language', aiTry.d.mode === 'ai' && /Hindi/.test(calls[calls.length - 1].body.system) && /First name: Test/.test(calls[calls.length - 1].body.messages[0].content) && !/Rs \d/.test(calls[calls.length - 1].body.messages[0].content), JSON.stringify(aiTry.d));
await srv2.stop();
ai.close();

await disconnect();
finish();
