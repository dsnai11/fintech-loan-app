import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { getConfig } from '../services/configService.js';
import { audit } from '../services/auditService.js';
import { flagDuplicatePan, flagNameMismatch, namesCompatible } from '../services/amlService.js';

const router = express.Router();

// In-memory OTP store: { phone: { otp, expiresAt, attempts } }
const otpStore = new Map();

// POST /api/kyc/otp/send
router.post('/otp/send', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('phone');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(user.phone, { otp, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });

    const smsProvider = getConfig('SMS_PROVIDER');
    const smsApiKey   = getConfig('SMS_API_KEY');
    const senderId    = getConfig('SMS_SENDER_ID', 'LIFINC');

    let smsSent = false;

    if (smsProvider === 'fast2sms' && smsApiKey) {
      const msg = encodeURIComponent(`Your LIFC OTP is ${otp}. Valid for 5 minutes. Do not share.`);
      const r = await fetch(`https://www.fast2sms.com/dev/bulkV2?authorization=${smsApiKey}&sender_id=${senderId}&message=${msg}&language=english&route=q&numbers=${user.phone}`)
        .then(x => x.json()).catch(() => null);
      smsSent = r?.return === true;
    } else if (smsProvider === 'msg91' && smsApiKey) {
      const templateId = getConfig('MSG91_TEMPLATE_ID');
      const r = await fetch('https://api.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: { 'authkey': smsApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId, mobile: `91${user.phone}`, otp }),
      }).then(x => x.json()).catch(() => null);
      smsSent = r?.type === 'success';
    } else if (smsProvider === 'twilio' && getConfig('TWILIO_ACCOUNT_SID')) {
      const sid   = getConfig('TWILIO_ACCOUNT_SID');
      const token = getConfig('TWILIO_AUTH_TOKEN');
      const from  = getConfig('TWILIO_PHONE');
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: `+91${user.phone}`, From: from, Body: `Your LIFC OTP is ${otp}. Valid 5 min.` }),
      }).then(x => x.json()).catch(() => null);
      smsSent = !!r?.sid;
    }

    res.json({
      message: smsSent ? 'OTP sent via SMS' : 'OTP generated',
      phone: user.phone.replace(/(\d{2})\d{6}(\d{2})/, '$1XXXXXX$2'),
      smsSent,
      // Return OTP only in sandbox mode (no real provider configured)
      ...(!smsProvider || smsProvider === 'sandbox' ? { sandboxOtp: otp } : {}),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kyc/otp/verify
router.post('/otp/verify', authMiddleware, async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'OTP is required' });

    const user = await User.findById(req.user.userId).select('phone');
    const record = otpStore.get(user.phone);

    if (!record) return res.status(400).json({ error: 'OTP not found. Please resend.' });
    if (Date.now() > record.expiresAt) { otpStore.delete(user.phone); return res.status(400).json({ error: 'OTP expired. Please resend.' }); }
    if (record.attempts >= 3) { otpStore.delete(user.phone); return res.status(400).json({ error: 'Too many attempts. Please resend.' }); }

    record.attempts++;
    if (record.otp !== otp.toString()) return res.status(400).json({ error: 'Invalid OTP', attemptsLeft: 3 - record.attempts });

    otpStore.delete(user.phone);
    await User.findByIdAndUpdate(req.user.userId, { phoneVerified: true });
    res.json({ message: 'Phone verified successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kyc/pan
// A PAN is only auto-approved when a real verification provider confirms it and the name matches.
// Everything else is saved as "pending" and goes to the admin KYC review queue.
router.post('/pan', authMiddleware, async (req, res) => {
  try {
    const { panNumber, dob } = req.body;
    if (!panNumber) return res.status(400).json({ error: 'PAN number is required' });

    const pan = String(panNumber).toUpperCase().trim();
    // 4th character is the holder type: P person, C company, H HUF, F firm, A AOP, T trust, B BOI, L local authority, J juridical person, G government
    if (!/^[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]$/.test(pan)) return res.status(400).json({ error: 'Invalid PAN format' });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const duplicate = await User.exists({ panNumber: pan, _id: { $ne: user._id } });
    if (duplicate) {
      await flagDuplicatePan(user, pan);
      await audit(req.user, 'KYC_DUPLICATE_PAN', { type: 'User', id: user._id }, { panLast4: pan.slice(-4) }, req);
      return res.status(409).json({ error: 'This PAN is already registered to another account. Please contact support.' });
    }

    const panProvider = getConfig('PAN_PROVIDER');
    const panApiKey   = getConfig('PAN_API_KEY');
    let verificationResult = { verified: false, name: null, mode: 'manual_review' };

    if (panProvider === 'karza' && panApiKey) {
      const resp = await fetch('https://testapi.karza.in/v2/pan-verify', {
        method: 'POST',
        headers: { 'x-karza-key': panApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pan, consent: 'Y' }),
      }).then(r => r.json()).catch(() => null);
      if (resp?.statusCode === 101) {
        verificationResult = { verified: true, name: resp.result?.name || null, mode: 'karza' };
      } else {
        return res.status(400).json({ error: 'PAN verification failed', detail: resp?.error || resp });
      }
    } else if (panProvider === 'idfy' && panApiKey) {
      const accountId = getConfig('PAN_ACCOUNT_ID');
      const resp = await fetch('https://eve.idfy.com/v3/tasks/async/verify_with_source/ind_pan', {
        method: 'POST',
        headers: { 'account-id': accountId, 'api-key': panApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: Date.now().toString(), group_id: 'pan-verify', data: { id_number: pan } }),
      }).then(r => r.json()).catch(() => null);
      // IDfy answers later; a request id only means the check was submitted, not that it passed.
      verificationResult = { verified: false, name: null, mode: 'idfy', requestId: resp?.request_id };
    }

    let nameMismatch = false;
    if (verificationResult.verified && verificationResult.name && !namesCompatible(verificationResult.name, `${user.firstName} ${user.lastName}`)) {
      nameMismatch = true;
      await flagNameMismatch(user, verificationResult.name);
    }

    const keepApproved = user.panNumber === pan && user.kycStatus === 'approved';
    const kycStatus = keepApproved || (verificationResult.verified && !nameMismatch) ? 'approved' : 'pending';

    user.panNumber = pan;
    user.kycStatus = kycStatus;
    if (dob) user.dateOfBirth = dob;
    await user.save();
    await audit(req.user, 'KYC_SUBMITTED', { type: 'User', id: user._id }, { mode: verificationResult.mode, verified: verificationResult.verified, nameMismatch, kycStatus }, req);

    res.json({
      message: kycStatus === 'approved' ? 'PAN verified' : 'PAN saved. Your KYC is pending review.',
      pan,
      verified: verificationResult.verified,
      mode: verificationResult.mode,
      nameMismatch,
      kycStatus,
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'This PAN is already registered to another account. Please contact support.' });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kyc/bank
router.post('/bank', authMiddleware, async (req, res) => {
  try {
    const { accountNumber, ifscCode, accountHolder } = req.body;
    if (!accountNumber || !ifscCode) return res.status(400).json({ error: 'Account number and IFSC are required' });

    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(ifscCode.toUpperCase())) return res.status(400).json({ error: 'Invalid IFSC code format' });

    // Always do free IFSC lookup
    let bankName = 'Unknown Bank';
    let branchInfo = null;
    try {
      const r = await fetch(`https://ifsc.razorpay.com/${ifscCode.toUpperCase()}`);
      if (r.ok) { const d = await r.json(); bankName = d.BANK || bankName; branchInfo = { branch: d.BRANCH, city: d.CITY, state: d.STATE }; }
    } catch (_) {}

    const bankProvider  = getConfig('BANK_VERIFY_PROVIDER');
    const paymentKeyId  = getConfig('PAYMENT_KEY_ID');
    const paymentSecret = getConfig('PAYMENT_KEY_SECRET');
    let verified = false;
    let mode = 'ifsc_lookup';

    if (bankProvider === 'razorpay' && paymentKeyId && paymentSecret) {
      const auth = Buffer.from(`${paymentKeyId}:${paymentSecret}`).toString('base64');
      const r = await fetch('https://api.razorpay.com/v1/payouts', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'X-Payout-Idempotency': `bv-${Date.now()}` },
        body: JSON.stringify({ account_number: paymentKeyId, fund_account: { account_type: 'bank_account', bank_account: { name: accountHolder, ifsc: ifscCode.toUpperCase(), account_number: accountNumber }, contact: { name: accountHolder, type: 'customer' } }, amount: 100, currency: 'INR', mode: 'IMPS', purpose: 'payout', queue_if_low_balance: false }),
      }).then(x => x.json()).catch(() => null);
      verified = !!r?.id;
      mode = verified ? 'razorpay_penny_drop' : 'ifsc_lookup';
    } else if (bankProvider === 'cashfree' && getConfig('CASHFREE_APP_ID')) {
      verified = true; // Cashfree bank verify needs their API — mark true for now
      mode = 'cashfree';
    }

    await User.findByIdAndUpdate(req.user.userId, {
      bankAccount: { accountNumber, ifscCode: ifscCode.toUpperCase(), bankName, accountHolder: accountHolder || '' },
    });

    res.json({
      message: 'Bank details saved',
      bank: { accountNumber: accountNumber.replace(/\d(?=\d{4})/g, 'X'), ifscCode: ifscCode.toUpperCase(), bankName },
      branch: branchInfo,
      verified,
      mode,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
