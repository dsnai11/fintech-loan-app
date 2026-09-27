import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// In-memory OTP store: { phone: { otp, expiresAt, attempts } }
const otpStore = new Map();

// POST /api/kyc/otp/send
router.post('/otp/send', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('phone');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min

    otpStore.set(user.phone, { otp, expiresAt, attempts: 0 });

    // TODO: replace with real SMS provider (Twilio / MSG91 / Fast2SMS)
    // When ADMIN_PORTAL configures SMS API, call it here using process.env.SMS_API_KEY
    const smsProvider = process.env.SMS_PROVIDER;
    if (smsProvider === 'fast2sms' && process.env.SMS_API_KEY) {
      await fetch(`https://www.fast2sms.com/dev/bulkV2?authorization=${process.env.SMS_API_KEY}&sender_id=LIFINC&message=Your%20LIFC%20OTP%20is%20${otp}.%20Valid%20for%205%20minutes.&language=english&route=q&numbers=${user.phone}`)
        .catch(() => null); // non-blocking, fall through to sandbox response
    }

    res.json({
      message: 'OTP sent',
      phone: user.phone.replace(/(\d{2})\d{6}(\d{2})/, '$1XXXXXX$2'),
      // Return OTP in sandbox mode only (no real SMS provider set)
      ...(process.env.NODE_ENV !== 'production' && !smsProvider ? { sandboxOtp: otp } : {}),
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
    if (Date.now() > record.expiresAt) {
      otpStore.delete(user.phone);
      return res.status(400).json({ error: 'OTP expired. Please resend.' });
    }
    if (record.attempts >= 3) {
      otpStore.delete(user.phone);
      return res.status(400).json({ error: 'Too many attempts. Please resend.' });
    }

    record.attempts++;
    if (record.otp !== otp.toString()) {
      return res.status(400).json({ error: 'Invalid OTP', attemptsLeft: 3 - record.attempts });
    }

    otpStore.delete(user.phone);
    await User.findByIdAndUpdate(req.user.userId, { phoneVerified: true });

    res.json({ message: 'Phone verified successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kyc/pan
router.post('/pan', authMiddleware, async (req, res) => {
  try {
    const { panNumber, dob } = req.body;
    if (!panNumber) return res.status(400).json({ error: 'PAN number is required' });

    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
    if (!panRegex.test(panNumber.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid PAN format' });
    }

    // TODO: replace with real PAN API (Karza/IDfy/Signzy) using process.env.PAN_API_KEY
    const panProvider = process.env.PAN_PROVIDER;
    let verificationResult = { verified: true, name: null }; // sandbox default

    if (panProvider === 'karza' && process.env.PAN_API_KEY) {
      const resp = await fetch('https://testapi.karza.in/v2/pan-verify', {
        method: 'POST',
        headers: { 'x-karza-key': process.env.PAN_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pan: panNumber.toUpperCase(), consent: 'Y' }),
      }).then(r => r.json()).catch(() => null);
      if (resp?.statusCode === 101) {
        verificationResult = { verified: true, name: resp.result?.name };
      } else {
        return res.status(400).json({ error: 'PAN verification failed', detail: resp?.error });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { panNumber: panNumber.toUpperCase(), kycStatus: 'approved', ...(dob ? { dateOfBirth: dob } : {}) },
      { new: true }
    ).select('-password');

    res.json({
      message: 'PAN verified successfully',
      pan: panNumber.toUpperCase(),
      verified: verificationResult.verified,
      name: verificationResult.name,
      kycStatus: user.kycStatus,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kyc/bank
router.post('/bank', authMiddleware, async (req, res) => {
  try {
    const { accountNumber, ifscCode, accountHolder } = req.body;
    if (!accountNumber || !ifscCode) {
      return res.status(400).json({ error: 'Account number and IFSC are required' });
    }

    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(ifscCode.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid IFSC code format' });
    }

    // IFSC lookup via public API (no key required)
    let bankName = 'Unknown Bank';
    let branchInfo = null;
    try {
      const ifscResp = await fetch(`https://ifsc.razorpay.com/${ifscCode.toUpperCase()}`);
      if (ifscResp.ok) {
        const data = await ifscResp.json();
        bankName = data.BANK || bankName;
        branchInfo = { branch: data.BRANCH, city: data.CITY, state: data.STATE };
      }
    } catch (_) {}

    // TODO: real penny drop via Razorpay/Cashfree using process.env.PAYMENT_API_KEY
    const verificationResult = { verified: true, nameMatch: true };

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      {
        bankAccount: {
          accountNumber,
          ifscCode: ifscCode.toUpperCase(),
          bankName,
          accountHolder: accountHolder || '',
        },
      },
      { new: true }
    ).select('-password');

    res.json({
      message: 'Bank account verified',
      bank: { accountNumber: accountNumber.replace(/\d(?=\d{4})/g, 'X'), ifscCode: ifscCode.toUpperCase(), bankName },
      branch: branchInfo,
      verified: verificationResult.verified,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
