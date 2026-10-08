import express from 'express';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { getConfig } from '../services/configService.js';
import { audit } from '../services/auditService.js';
import { sendCode, verifyCode } from '../services/phoneVerification.js';
import { flagDuplicatePan, flagNameMismatch, namesCompatible } from '../services/amlService.js';
import { verifyBank } from '../services/bankVerifyService.js';

const router = express.Router();

// The phone check lives in services/phoneVerification.js. These two routes stay so older app builds keep working.
router.post('/otp/send', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await sendCode(user);
    res.status(r.status).json(r.body);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/otp/verify', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const r = await verifyCode(user, req.body?.otp, req);
    res.status(r.status).json(r.body);
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

    // Save the account, then check it with the bank through the payment provider (or the test mode)
    const saved = await User.findByIdAndUpdate(req.user.userId, {
      bankAccount: { accountNumber, ifscCode: ifscCode.toUpperCase(), bankName, accountHolder: accountHolder || '' },
    }, { new: true });
    const check = await verifyBank(saved, req);
    const verified = check.status === 'verified';
    const mode = check.mode;

    res.json({
      message: 'Bank details saved',
      bank: { accountNumber: accountNumber.replace(/\d(?=\d{4})/g, 'X'), ifscCode: ifscCode.toUpperCase(), bankName },
      branch: branchInfo,
      verified,
      mode,
      status: check.status,
      nameAtBank: check.nameAtBank || null,
      note: check.note || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Run the bank check again (for example after the provider was set up)
router.post('/bank/verify', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user?.bankAccount?.accountNumber) return res.status(400).json({ error: 'Add your bank account first.' });
    const recent = user.bankVerification?.at && Date.now() - new Date(user.bankVerification.at).getTime() < 60 * 1000;
    if (recent) return res.status(429).json({ error: 'Please wait a minute before checking again.' });
    const check = await verifyBank(user, req);
    res.json({ verified: check.status === 'verified', status: check.status, nameAtBank: check.nameAtBank || null, note: check.note || null, mode: check.mode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
