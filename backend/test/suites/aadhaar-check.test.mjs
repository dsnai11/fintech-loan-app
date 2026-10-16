import fs from 'fs';
import http from 'http';
import { check, section, connect, disconnect, startServer, finish, makeAdmin, tokenFor, client } from '../lib.mjs';
import User from '../../src/models/User.js';
import KycMedia from '../../src/models/KycMedia.js';
import AmlAlert from '../../src/models/AmlAlert.js';
import AuditLog from '../../src/models/AuditLog.js';
import { verhoeffValid, verhoeffCheckDigit, findAadhaarNumber, judgeText } from '../../src/services/aadhaarCardCheck.js';

const DB = 'fintech-test-aadhaar-check';
await connect(DB);
const fixture = f => fs.readFileSync(new URL('../fixtures/' + f, import.meta.url)).toString('base64');
const aadhaarPhoto = fixture('aadhaar-sample.jpg'); // a drawn stand-in, number 2345 6789 0124
const otherPhoto = fixture('not-aadhaar-sample.jpg'); // an electricity bill

section('THE AADHAAR NUMBER CHECK DIGIT');
check('a real Aadhaar-style number passes the check digit', verhoeffValid('234567890124'));
check('one wrong digit fails', !verhoeffValid('234567890125') && !verhoeffValid('234567890134'));
check('a made-up 12-digit number usually fails', !verhoeffValid('123456789012'));
check('the check digit can be worked out and verified', [0, 1, 2].every(i => verhoeffValid('3456789012' + i + verhoeffCheckDigit('3456789012' + i))));
check('non-digits are not a number', !verhoeffValid('23456789012a') && !verhoeffValid(''));

section('READING THE TEXT ON A CARD');
check('a number in groups of four is found', findAadhaarNumber('Name\n2345 6789 0124\nFemale').number === '234567890124');
check('hyphens and no spaces work', findAadhaarNumber('2345-6789-0124').number === '234567890124' && findAadhaarNumber('234567890124').number === '234567890124');
check('a number starting with 0 or 1 is not an Aadhaar number', judgeText('Aadhaar 0123 4567 8901').ok === false);
check('a card needs the number and the words together', judgeText('Government of India\nAadhaar\n2345 6789 0124').ok === true && judgeText('Government of India\nAadhaar\n2345 6789 0124').last4 === '0124');
check('Hindi words count too', judgeText('भारत सरकार\n2345 6789 0124').ok === true && judgeText('आधार 2345 6789 0124').ok === true);
check('a valid-looking number without any card words is not accepted', judgeText('Order no 2345 6789 0124 thanks').ok === false);
check('card words without a number are not accepted, and say so', judgeText('Government of India Aadhaar').reason === 'number_not_readable');
check('an invalid number is not accepted', judgeText('Aadhaar 2345 6789 0120').reason === 'number_not_valid');
check('nothing on the picture is not accepted', judgeText('').reason === 'no_text' && judgeText('   ').reason === 'no_text');

// The real text reader on our own server, with real pictures
const srv = await startServer(DB, {});
const call = client(srv.base);
let n = 0;
const customer = async (over = {}) => {
  n++;
  const user = await User.create({ firstName: `A${n}`, lastName: 'C', email: `ac${n}@x.in`, phone: `92${String(n).padStart(8, '0')}`, password: 'x12345678', kycStatus: 'approved', phoneVerified: true, ...over });
  return { user, token: await tokenFor(user) };
};
const card = (c, photo) => call('POST', '/onboarding/aadhaar-card', c.token, { photo });

section('THE PHOTO IS CHECKED BEFORE IT IS KEPT');
const c1 = await customer();
const bill = await card(c1, otherPhoto);
check('a photo of something else is turned away (422)', bill.s === 422 && bill.d.code === 'NOT_AADHAAR' && /does not look like an Aadhaar card/.test(bill.d.error), JSON.stringify(bill.d));
check('and nothing was kept', (await KycMedia.countDocuments({ userId: c1.user._id, kind: 'aadhaar_card' })) === 0 && !(await User.findById(c1.user._id)).aadhaarCard);
check('the setup step is still not done', (await call('GET', '/onboarding/status', c1.token)).d.steps.aadhaarCard === false);
check('the refusal is in the audit log with the reason', (await AuditLog.countDocuments({ action: 'AADHAAR_CARD_TURNED_AWAY', entityId: String(c1.user._id) })) === 1);
const good = await card(c1, aadhaarPhoto);
check('an Aadhaar card photo is accepted', good.s === 200 && good.d.aadhaarCard.status === 'review', JSON.stringify(good.d));
const u1 = await User.findById(c1.user._id);
check('only the last 4 digits are kept, never the whole number', u1.aadhaarCard.documentCheck.checked === true && u1.aadhaarCard.documentCheck.last4 === '0124' && !JSON.stringify(u1.aadhaarCard).includes('234567890124') && !JSON.stringify(u1.aadhaarCard).includes('2345 6789'));

section("IS IT THE CUSTOMER'S OWN CARD?");
const c2 = await customer({ kycDigilocker: { status: 'verified', aadhaarLast4: '9999' } });
const notTheirs = await card(c2, aadhaarPhoto);
check('a card whose last 4 digits differ from their DigiLocker Aadhaar is refused (422)', notTheirs.s === 422 && notTheirs.d.code === 'NOT_YOUR_AADHAAR', JSON.stringify(notTheirs.d));
check('and a high-priority alert is raised', (await AmlAlert.countDocuments({ rule: 'AADHAAR_MISMATCH', userId: c2.user._id, severity: 'HIGH' })) === 1);
const c3 = await customer({ kycDigilocker: { status: 'verified', aadhaarLast4: '0124' } });
const theirs = await card(c3, aadhaarPhoto);
check('their own card is accepted, and the match with DigiLocker is recorded', theirs.s === 200 && (await User.findById(c3.user._id)).aadhaarCard.documentCheck.numberMatchesDigilocker === true);

section('WHEN THE TEXT READER IS SWITCHED OFF IT DOES NOT GUESS');
const offSrv = await startServer(DB, { AADHAAR_TEXT_READER: 'off' });
const c4 = await customer();
const r4 = await client(offSrv.base)('POST', '/onboarding/aadhaar-card', c4.token, { photo: otherPhoto });
check('the photo goes to a person, flagged as not checked', r4.s === 200 && (await User.findById(c4.user._id)).aadhaarCard.flag === 'document_not_checked' && (await User.findById(c4.user._id)).aadhaarCard.documentCheck.checked === false);

section('AMAZON READS THE TEXT WHEN ITS KEYS ARE SET');
let lines = ['Government of India', 'Anita Rao', '2345 6789 0124'];
const seen = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    seen.push(req.headers['x-amz-target']);
    res.setHeader('Content-Type', 'application/x-amz-json-1.1');
    res.end(JSON.stringify({ TextDetections: lines.map(t => ({ Type: 'LINE', DetectedText: t })) }));
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const aws = await startServer(DB, { AWS_ACCESS_KEY_ID: 'AKIATESTTESTTEST', AWS_SECRET_ACCESS_KEY: 'secretsecret', AWS_REGION: 'ap-south-1', AWS_REKOGNITION_ENDPOINT: `http://127.0.0.1:${mock.address().port}/`, FACE_MATCH_AUTO: 'false' });
const callAws = client(aws.base);
const c5 = await customer();
const r5 = await callAws('POST', '/onboarding/aadhaar-card', c5.token, { photo: otherPhoto });
check('the text comes from Amazon, and a card is accepted', r5.s === 200 && seen[0] === 'RekognitionService.DetectText' && (await User.findById(c5.user._id)).aadhaarCard.documentCheck.reader === 'aws_rekognition', JSON.stringify(r5.d));
lines = ['Electricity bill', 'Amount due 1250'];
const c6 = await customer();
check('and something that is not a card is turned away', (await callAws('POST', '/onboarding/aadhaar-card', c6.token, { photo: aadhaarPhoto })).d.code === 'NOT_AADHAAR');

for (const s of [srv, offSrv, aws]) await s.stop();
mock.close();
await disconnect();
finish();
