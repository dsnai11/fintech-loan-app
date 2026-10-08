import express from 'express';
import jwt from 'jsonwebtoken';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { screenLoan } from '../services/amlService.js';
import { getPolicy, computeQuote, checkRequest, quoteProblem } from '../services/pricingPolicy.js';
import { contextFor } from '../services/chargeContext.js';
import { policyFor } from '../services/appSettings.js';
import { topUp } from '../services/topupService.js';
import { incomeBasis } from '../services/aaService.js';
import { termsRequiredFor } from '../services/terms.js';
import { decideLoan } from '../services/decisionEngine.js';
import { setupStatus } from '../services/onboardingService.js';
import { makeOffer, activeOffer, publicOffer, offerCap } from '../services/offerService.js';
import { renderClosureLetter } from '../services/closureLetter.js';
import { renderStatement } from '../services/loanStatement.js';
import { repeatEligibility, maxAmountFor } from '../services/repeatLoan.js';
import EMIPayment from '../models/EMIPayment.js';

const PURPOSES = ['Personal', 'Business', 'Education', 'Medical', 'Other'];

const router = express.Router();

// Submit full loan application (from the 7-step flow)
router.post('/apply-full', authMiddleware, async (req, res) => {
  try {
    const {
      loanAmount,
      tenure,
      purpose,
      loanType,
      planType, // 'one_time' | '3_emi' | '6_emi'
      bankDetails, // { accountHolder, accountNumber, ifscCode }
      personalDetails, // { pincode, gender, address, email }
    } = req.body;

    const namedPlan = planType && planType !== 'standard';
    if (!loanAmount || !purpose || (!tenure && !namedPlan)) {
      return res.status(400).json({ error: 'Loan amount, tenure, and purpose are required' });
    }
    if (!PURPOSES.includes(purpose)) return res.status(400).json({ error: `Purpose must be one of: ${PURPOSES.join(', ')}` });

    const policy = policyFor(req.body.productKey ? String(req.body.productKey) : undefined);
    if (!policy) return res.status(400).json({ error: 'That loan product is not available' });
    const request = { amount: Number(loanAmount), planType: planType || undefined, tenureMonths: tenure === undefined ? undefined : Number(tenure) };
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (termsRequiredFor(user)) return res.status(403).json({ error: 'Please accept the updated terms and conditions first.', code: 'TERMS_REQUIRED' });
    if (process.env.REQUIRE_PHONE_VERIFIED !== 'false' && !user.phoneVerified) return res.status(403).json({ error: 'Verify your phone number first. Open the app and enter the code we send you.', code: 'PHONE_NOT_VERIFIED' });
    if (process.env.REQUIRE_ONBOARDING !== 'false' && !setupStatus(user).complete) return res.status(403).json({ error: 'Finish setting up your account first: your personal details, a photo and your bank account.', code: 'ONBOARDING_INCOMPLETE' });

    // The most this customer can borrow: the product limit, and their own offer after the credit check.
    const { cap, offer } = await offerCap(user, getPolicy());
    if (offer && offer.status === 'DECLINED') return res.status(403).json({ error: offer.reason || 'We are not able to offer you a loan at this time.', code: 'NOT_ELIGIBLE' });
    const problem = checkRequest(policy, request, Math.min(await maxAmountFor(req.user.userId, policy), cap));
    if (problem) return res.status(400).json({ error: offer ? `${problem}. Your offer is up to Rs ${offer.amount.toLocaleString('en-IN')}.` : problem, code: 'ABOVE_LIMIT' });

    // The customer's state decides which state charges apply; the add-ons are the ones they ticked.
    const ctx = contextFor(user, { state: req.body.personalDetails?.state, pincode: req.body.personalDetails?.pincode, optional: req.body.optionalCharges });
    const quote = computeQuote(policy, request, ctx);
    if (ctx.optional.some(id => !quote.charges.some(c => c.id === id && c.optional))) return res.status(400).json({ error: 'One of the add-ons you chose is not available for this loan' });
    const tooBig = quoteProblem(quote);
    if (tooBig) return res.status(400).json({ error: tooBig });

    // Update user profile with personal + bank details
    if (personalDetails) {
      user.gender = personalDetails.gender || user.gender;
      if (personalDetails.address) {
        user.address = { street: personalDetails.address, zipCode: personalDetails.pincode };
      }
    }
    if (bankDetails) {
      user.bankAccount = {
        accountNumber: bankDetails.accountNumber,
        ifscCode: bankDetails.ifscCode,
        accountHolder: bankDetails.accountHolder || `${user.firstName} ${user.lastName}`,
        bankName: _inferBankName(bankDetails.ifscCode),
      };
    }

    // Fees, EMI and tenure all come from the pricing policy (see services/pricingPolicy.js).
    const { processingFee, gst, netDisbursed: disbursedAmount, emi: monthlyEMI, tenureMonths: actualTenure } = quote;

    // Build repayment schedule
    const repaymentHistory = [];
    const startDate = new Date();
    for (let i = 1; i <= actualTenure; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      repaymentHistory.push({
        month: i,
        emiAmount: monthlyEMI,
        paidAmount: 0,
        status: 'pending',
        dueDate,
      });
    }

    const loan = new Loan({
      userId: req.user.userId,
      loanAmount: quote.amount,
      tenure: actualTenure,
      purpose,
      loanType: loanType || 'Personal Loan',
      productKey: policy.productKey || 'personal',
      interestRate: quote.interestRatePercent,
      monthlyEMI,
      totalAmount: quote.totalRepayable,
      status: 'submitted',
      planType: quote.planType !== 'standard' ? quote.planType : undefined,
      kfs: { ...quote, chargeState: ctx.state, productKey: policy.productKey || 'personal', productName: policy.productName || 'Personal Loan' },
      disbursalDetails: {
        accountNumber: bankDetails?.accountNumber || '',
        bankName: _inferBankName(bankDetails?.ifscCode),
        disbursedAmount,
      },
      repaymentHistory,
    });

    await loan.save();
    user.loanHistory.push(loan._id);
    await user.save();
    await audit(req.user, 'LOAN_APPLIED', { type: 'Loan', id: loan._id }, { amount: loan.loanAmount, tenure: loan.tenure }, req);
    await screenLoan(loan, user);
    await decideLoan(loan, user);

    res.status(201).json({
      message: 'Loan application submitted successfully',
      loan: {
        id: loan._id,
        loanAmount: loan.loanAmount,
        tenure: loan.tenure,
        monthlyEMI: loan.monthlyEMI,
        totalAmount: loan.totalAmount,
        status: loan.status,
        interestRate: loan.interestRate,
        disbursedAmount,
        processingFee,
        gst,
        gstPercent: quote.gstPercent,
        aprPercent: quote.aprPercent,
        kfs: { ...quote, chargeState: ctx.state, productKey: policy.productKey || 'personal', productName: policy.productName || 'Personal Loan' },
        repaymentSchedule: repaymentHistory.map((r) => ({
          month: r.month,
          dueDate: r.dueDate,
          amount: r.emiAmount,
          status: r.status,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy apply endpoint
router.post('/apply', authMiddleware, async (req, res) => {
  try {
    const { loanAmount, tenure, purpose, loanType } = req.body;

    if (!loanAmount || !tenure || !purpose) {
      return res.status(400).json({ error: 'Loan amount, tenure, and purpose are required' });
    }
    if (!PURPOSES.includes(purpose)) return res.status(400).json({ error: `Purpose must be one of: ${PURPOSES.join(', ')}` });

    const policy = policyFor(req.body.productKey ? String(req.body.productKey) : undefined);
    if (!policy) return res.status(400).json({ error: 'That loan product is not available' });
    const request = { amount: Number(loanAmount), planType: 'standard', tenureMonths: Number(tenure) };
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (termsRequiredFor(user)) return res.status(403).json({ error: 'Please accept the updated terms and conditions first.', code: 'TERMS_REQUIRED' });
    if (process.env.REQUIRE_PHONE_VERIFIED !== 'false' && !user.phoneVerified) return res.status(403).json({ error: 'Verify your phone number first. Open the app and enter the code we send you.', code: 'PHONE_NOT_VERIFIED' });
    if (process.env.REQUIRE_ONBOARDING !== 'false' && !setupStatus(user).complete) return res.status(403).json({ error: 'Finish setting up your account first: your personal details, a photo and your bank account.', code: 'ONBOARDING_INCOMPLETE' });

    // The most this customer can borrow: the product limit, and their own offer after the credit check.
    const { cap, offer } = await offerCap(user, getPolicy());
    if (offer && offer.status === 'DECLINED') return res.status(403).json({ error: offer.reason || 'We are not able to offer you a loan at this time.', code: 'NOT_ELIGIBLE' });
    // With a loan already running, the customer can borrow only what is left of their limit (a top-up), and only if they pay on time
    const limit = Math.min(await maxAmountFor(req.user.userId, policy), cap);
    const tu = await topUp(req.user.userId, limit);
    if (tu.hasLiveLoan && !tu.eligible) return res.status(403).json({ error: tu.reason, code: 'TOPUP_NOT_AVAILABLE' });
    let allowed = tu.hasLiveLoan ? tu.maxAmount : limit;
    // A salary advance is limited to a share of monthly income
    if (policy.maxIncomePercent) {
      const inc = incomeBasis(user);
      if (!(inc.amount > 0)) return res.status(400).json({ error: 'Add your monthly income, or share your bank statements, to use this.', code: 'INCOME_NEEDED' });
      allowed = Math.min(allowed, Math.floor((inc.amount * policy.maxIncomePercent) / 100 / 100) * 100);
    }
    const problem = checkRequest(policy, request, allowed);
    if (problem) return res.status(400).json({ error: tu.hasLiveLoan ? `${problem}. You still owe Rs ${tu.outstanding.toLocaleString('en-IN')} on your current loan, which counts against your limit.` : offer ? `${problem}. Your offer is up to Rs ${offer.amount.toLocaleString('en-IN')}.` : problem, code: 'ABOVE_LIMIT' });

    // The customer's state decides which state charges apply; the add-ons are the ones they ticked.
    const ctx = contextFor(user, { state: req.body.personalDetails?.state, pincode: req.body.personalDetails?.pincode, optional: req.body.optionalCharges });
    const quote = computeQuote(policy, request, ctx);
    if (ctx.optional.some(id => !quote.charges.some(c => c.id === id && c.optional))) return res.status(400).json({ error: 'One of the add-ons you chose is not available for this loan' });
    const tooBig = quoteProblem(quote);
    if (tooBig) return res.status(400).json({ error: tooBig });

    const loan = new Loan({
      userId: req.user.userId,
      loanAmount: quote.amount,
      tenure: quote.tenureMonths,
      purpose,
      loanType: loanType || 'Personal Loan',
      productKey: policy.productKey || 'personal',
      interestRate: quote.interestRatePercent,
      monthlyEMI: quote.emi,
      totalAmount: quote.totalRepayable,
      kfs: { ...quote, chargeState: ctx.state, productKey: policy.productKey || 'personal', productName: policy.productName || 'Personal Loan' },
      disbursalDetails: { disbursedAmount: quote.netDisbursed },
    });

    await loan.save();
    user.loanHistory.push(loan._id);
    await user.save();
    await audit(req.user, 'LOAN_APPLIED', { type: 'Loan', id: loan._id }, { amount: loan.loanAmount, tenure: loan.tenure }, req);
    await screenLoan(loan, user);
    await decideLoan(loan, user);

    res.status(201).json({
      message: 'Loan application submitted',
      loan: {
        id: loan._id,
        loanAmount: loan.loanAmount,
        tenure: loan.tenure,
        monthlyEMI: loan.monthlyEMI,
        totalAmount: loan.totalAmount,
        status: loan.status,
        interestRate: loan.interestRate,
        disbursedAmount: quote.netDisbursed,
        processingFee: quote.processingFee,
        gst: quote.gst,
        gstPercent: quote.gstPercent,
        aprPercent: quote.aprPercent,
        kfs: { ...quote, chargeState: ctx.state, productKey: policy.productKey || 'personal', productName: policy.productName || 'Personal Loan' },
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Loan closure letter / no-dues certificate, for the borrower (or an admin) once the loan is closed
router.get('/:loanId/closure-letter', authMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.loanId).catch(() => null);
    const isAdmin = req.user.isAdmin || String(req.user.email).toLowerCase() === (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase();
    if (!loan || (!isAdmin && String(loan.userId) !== String(req.user.userId))) return res.status(404).json({ error: 'Loan not found' });
    if (loan.status !== 'closed') return res.status(400).json({ error: 'A closure letter is available once the loan is closed' });
    const user = await User.findById(loan.userId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderClosureLetter(loan, user));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function statementHtml(loan) {
  const [user, emis] = await Promise.all([User.findById(loan.userId), EMIPayment.find({ loanId: loan._id }).sort({ emiNumber: 1 })]);
  return renderStatement(loan, user, emis);
}
const statementReady = loan => ['disbursed', 'closed'].includes(loan.status);
const isAdminReq = req => req.user.isAdmin || String(req.user.email).toLowerCase() === (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase();

// The credit check and the loan offer that comes from it. The customer has to agree to the credit check first.
router.post('/check-eligibility', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (termsRequiredFor(user)) return res.status(403).json({ error: 'Please accept the updated terms and conditions first.', code: 'TERMS_REQUIRED' });
    if (process.env.REQUIRE_PHONE_VERIFIED !== 'false' && !user.phoneVerified) return res.status(403).json({ error: 'Verify your phone number first. Open the app and enter the code we send you.', code: 'PHONE_NOT_VERIFIED' });
    if (!user.bureauConsentAt) {
      if (req.body?.consent !== true) return res.status(400).json({ error: 'We need your permission to check your credit record.', code: 'CONSENT_REQUIRED' });
      user.bureauConsentAt = new Date();
      await User.updateOne({ _id: user._id }, { bureauConsentAt: user.bureauConsentAt });
      await audit(req.user, 'CREDIT_CHECK_CONSENT', { type: 'User', id: user._id }, {}, req);
    }
    const policy = getPolicy();
    const offer = await makeOffer(user, policy, { pullCredit: true });
    await audit(req.user, 'ELIGIBILITY_CHECKED', { type: 'User', id: user._id }, { status: offer.status, amount: offer.amount, creditCheck: offer.source }, req);
    res.json({ offer: publicOffer(offer), minAmount: policy.minAmount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// The customer's current offer, if they have one that is still valid
router.get('/my-offer', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('offer');
    const policy = getPolicy();
    const offer = activeOffer(user);
    const tu = await topUp(req.user.userId, offer && offer.status !== 'DECLINED' ? offer.amount : policy.maxAmount);
    res.json({ offer: publicOffer(offer), minAmount: policy.minAmount, maxAmount: policy.maxAmount, topUp: tu.hasLiveLoan ? tu : null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// What this customer may borrow now, and how to unlock more if they cannot yet
router.get('/repeat-offer', authMiddleware, async (req, res) => {
  try {
    res.json(await repeatEligibility(req.user.userId, getPolicy()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Account statement: payout, every instalment, late fees and what is still owed
router.get('/:loanId/statement', authMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.loanId).catch(() => null);
    if (!loan || (!isAdminReq(req) && String(loan.userId) !== String(req.user.userId))) return res.status(404).json({ error: 'Loan not found' });
    if (!statementReady(loan)) return res.status(400).json({ error: 'A statement is available once the loan has been paid out' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(await statementHtml(loan));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// The mobile app cannot attach a login header to a browser tab, so it asks for a link that works for
// 5 minutes and for this one statement only.
router.post('/:loanId/statement-link', authMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.loanId).catch(() => null);
    if (!loan || String(loan.userId) !== String(req.user.userId)) return res.status(404).json({ error: 'Loan not found' });
    if (!statementReady(loan)) return res.status(400).json({ error: 'A statement is available once the loan has been paid out' });
    const t = jwt.sign({ purpose: 'statement', loanId: String(loan._id), userId: String(loan.userId) }, process.env.JWT_SECRET, { expiresIn: '5m' });
    res.json({ path: `/api/loans/statement-view?t=${t}`, expiresInSeconds: 300 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/statement-view', async (req, res) => {
  try {
    const d = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET);
    if (d.purpose !== 'statement') throw new Error('wrong purpose');
    const loan = await Loan.findById(d.loanId).catch(() => null);
    if (!loan || String(loan.userId) !== d.userId || !statementReady(loan)) return res.status(404).send('Statement not found');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(await statementHtml(loan));
  } catch {
    res.status(401).send('This link has expired. Open the statement again from the app.');
  }
});

// Get all loans for user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const loans = await Loan.find({ userId: req.user.userId })
      .select('-repaymentHistory')
      .sort({ createdAt: -1 });
    res.json(loans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single loan with repayment schedule
router.get('/:loanId', authMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.userId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    res.json(loan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function _inferBankName(ifsc) {
  if (!ifsc) return 'Unknown Bank';
  const code = ifsc.substring(0, 4).toUpperCase();
  const banks = {
    SBIN: 'State Bank of India', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank',
    AXIS: 'Axis Bank', KKBK: 'Kotak Mahindra Bank', PUNB: 'Punjab National Bank',
    BARB: 'Bank of Baroda', CNRB: 'Canara Bank', UBIN: 'Union Bank of India',
    IOBA: 'Indian Overseas Bank',
  };
  return banks[code] || 'Unknown Bank';
}

export default router;
