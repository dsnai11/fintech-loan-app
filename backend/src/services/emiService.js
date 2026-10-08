import EMIPayment from '../models/EMIPayment.js';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import axios from 'axios';
import { notify, templates } from './notificationService.js';
import { getPolicy, lateFeeFor } from './pricingPolicy.js';

const RAZORPAY_API = 'https://api.razorpay.com/v1';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
const razorpayAuth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

// The 3 and 6 month plans charge flat interest (e.g. 5% of the loan, split evenly). Loans made before
// planType was stored are recognised by their numbers: total repayable equals loan x (1 + rate).
export function isFlatInterest(loan, emi) {
  if (loan.planType) return true;
  return Math.abs(emi * loan.tenure - loan.loanAmount * (1 + (loan.interestRate || 0) / 100)) <= loan.tenure;
}

// ═══════════════════════════════════════════════════════════════════
// CREATE EMI SCHEDULE FOR LOAN
// ═══════════════════════════════════════════════════════════════════

export async function createEMISchedule(loanId) {
  try {
    const loan = await Loan.findById(loanId);
    if (!loan) throw new Error('Loan not found');

    // Delete existing schedule if any
    await EMIPayment.deleteMany({ loanId });

    const monthlyEMI = loan.monthlyEMI || calculateEMI(loan);
    const tenure = loan.tenure;
    const startDate = loan.disbursementDate || new Date();
    const principalTotal = loan.loanAmount;
    const flat = isFlatInterest(loan, monthlyEMI);
    const monthlyRate = loan.interestRate / 12 / 100;

    // Whatever the plan, the principal parts add up to exactly the loan amount.
    let balance = principalTotal;
    for (let i = 1; i <= tenure; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      const last = i === tenure;

      let principalAmount;
      let interestAmount;
      if (flat) {
        // Flat plans: the same principal and the same interest every month.
        principalAmount = last ? balance : Math.round(principalTotal / tenure);
        interestAmount = Math.max(0, monthlyEMI - principalAmount);
      } else {
        // Reducing balance: interest on what is still owed; the last EMI clears whatever is left.
        const accrued = Math.round(balance * monthlyRate);
        principalAmount = last ? balance : Math.min(balance, monthlyEMI - accrued);
        interestAmount = last ? Math.max(0, monthlyEMI - principalAmount) : accrued;
      }

      await EMIPayment.create({
        loanId,
        userId: loan.userId,
        emiNumber: i,
        dueDate,
        amount: principalAmount + interestAmount,
        principalAmount,
        interestAmount,
        status: 'PENDING',
      });

      balance -= principalAmount;
    }

    console.log(`✅ EMI schedule created for loan ${loanId}: ${tenure} months`);
    return { success: true, emis: tenure };
  } catch (error) {
    console.error('Error creating EMI schedule:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// GET EMI SCHEDULE
// ═══════════════════════════════════════════════════════════════════

export async function getEMISchedule(loanId) {
  try {
    const emis = await EMIPayment.find({ loanId }).sort({ emiNumber: 1 });

    const stats = {
      total: emis.length,
      pending: emis.filter(e => e.status === 'PENDING').length,
      paid: emis.filter(e => e.status === 'PAID').length,
      overdue: emis.filter(e => e.status === 'OVERDUE').length,
      failed: emis.filter(e => e.status === 'FAILED').length,
    };

    return { emis, stats };
  } catch (error) {
    console.error('Error fetching EMI schedule:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CHECK & UPDATE OVERDUE EMIS
// ═══════════════════════════════════════════════════════════════════

export async function checkAndMarkOverdue() {
  try {
    const now = new Date();
    const overdueEmis = await EMIPayment.find({
      status: 'PENDING',
      dueDate: { $lt: now },
    });

    for (const emi of overdueEmis) {
      const daysOverdue = Math.floor((now - emi.dueDate) / (1000 * 60 * 60 * 24));

      await EMIPayment.findByIdAndUpdate(emi._id, {
        status: 'OVERDUE',
        daysOverdue,
      });

      // Late fee comes from the pricing policy
      const penalty = lateFeeFor(getPolicy(), emi.amount, Math.ceil(daysOverdue / 30));

      await EMIPayment.findByIdAndUpdate(emi._id, {
        penaltyApplied: penalty,
        penaltyReason: `${daysOverdue} days overdue`,
      });
    }

    console.log(`✅ Marked ${overdueEmis.length} EMIs as overdue`);
    return { markedOverdue: overdueEmis.length };
  } catch (error) {
    console.error('Error checking overdue EMIs:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// INITIATE EMI PAYMENT
// ═══════════════════════════════════════════════════════════════════

export async function initiateEMIPayment(loanId, emiNumber, userId) {
  try {
    const emi = await EMIPayment.findOne({ loanId, emiNumber });
    if (!emi) throw new Error('EMI not found');

    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const loan = await Loan.findById(loanId);
    if (!loan) throw new Error('Loan not found');
    if (loan.status === 'written_off') throw Object.assign(new Error('This loan has been written off. Please contact support.'), { status: 409 });

    if (emi.status === 'PAID') throw new Error('EMI already paid');

    const totalAmount = emi.amount + emi.penaltyApplied;

    if (process.env.PAYMENT_MODE !== 'PRODUCTION') {
      await markEMIPaid(emi, `sandbox_${Date.now()}`);
      return { success: true, sandbox: true, status: 'PAID', amount: totalAmount, emiNumber };
    }

    // Razorpay invoice creation
    const invoiceResponse = await axios.post(
      `${RAZORPAY_API}/invoices`,
      {
        customer: {
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          contact: user.phone,
        },
        line_items: [
          {
            item_code: `EMI-${loanId}-${emiNumber}`,
            description: `EMI #${emiNumber} - Loan ${loanId}`,
            amount: Math.round(totalAmount * 100),
            currency: 'INR',
            quantity: 1,
          },
        ],
        receipt: `EMI-${loanId}-${emiNumber}-${Date.now()}`,
        notes: {
          loanId: loanId.toString(),
          emiNumber: emiNumber.toString(),
        },
      },
      {
        headers: {
          'Authorization': `Basic ${razorpayAuth}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const invoiceId = invoiceResponse.data.id;

    // Update EMI with invoice details
    await EMIPayment.findByIdAndUpdate(emi._id, {
      orderId: invoiceId,
      metadata: {
        razorpayResponse: invoiceResponse.data,
      },
    });

    return {
      success: true,
      emiId: emi._id,
      invoiceId,
      paymentUrl: invoiceResponse.data.short_url || null,
      amount: totalAmount,
      emiNumber,
    };
  } catch (error) {
    console.error('Error initiating EMI payment:', error.message);
    throw error;
  }
}

export async function markEMIPaid(emi, paymentId, amountPaid) {
  const paid = amountPaid ?? emi.amount + emi.penaltyApplied;
  await EMIPayment.findByIdAndUpdate(emi._id, {
    status: 'PAID',
    paymentId,
    paidDate: new Date(),
    paidAmount: paid,
  });

  await notify(emi.userId, templates.emiPaid(emi, paid), { sms: true });
  try { await (await import('./rewardsService.js')).afterPayment(emi.userId); } catch (e) { console.error('Rewards failed:', e.message); }
  try { await (await import('./colendingService.js')).onEmiPaid(emi._id); } catch (e) { console.error('Co-lending entry failed:', e.message); }

  const unpaid = await EMIPayment.countDocuments({ loanId: emi.loanId, status: { $ne: 'PAID' } });
  if (unpaid === 0) {
    await Loan.findByIdAndUpdate(emi.loanId, { status: 'closed', closedAt: new Date(), closureType: 'repaid' });
    await notify(emi.userId, templates.closed(emi.loanId), { sms: true });
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROCESS EMI PAYMENT (Webhook)
// ═══════════════════════════════════════════════════════════════════

export async function processEMIPayment(paymentData) {
  try {
    const { invoice_id, payment_id, status, amount_paid } = paymentData;

    const emi = await EMIPayment.findOne({ orderId: invoice_id });
    if (!emi) {
      // Not one of ours (or already cleaned up). Acknowledge so Razorpay does not keep retrying.
      console.warn(`Webhook for unknown invoice ${invoice_id} ignored`);
      return { success: true, ignored: true, reason: 'unknown invoice' };
    }

    if (status === 'paid') {
      if (emi.status === 'PAID') return { success: true, alreadyPaid: true };
      if (typeof amount_paid === 'number' && amount_paid + 1 < emi.amount) {
        console.error(`EMI ${emi._id}: invoice ${invoice_id} paid ${amount_paid}, expected at least ${emi.amount}. Not marking paid.`);
        return { success: false, reason: 'underpaid' };
      }
      await markEMIPaid(emi, payment_id, typeof amount_paid === 'number' ? amount_paid : undefined);
    } else if (status === 'issued') {
      // Payment pending
      await EMIPayment.findByIdAndUpdate(emi._id, {
        status: 'PENDING',
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Error processing EMI payment:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Calculate EMI
// ═══════════════════════════════════════════════════════════════════

function calculateEMI(loan) {
  const P = loan.loanAmount;
  const R = loan.interestRate / 12 / 100;
  const N = loan.tenure;
  const emi = (P * R * Math.pow(1 + R, N)) / (Math.pow(1 + R, N) - 1);
  return Math.round(emi);
}

// ═══════════════════════════════════════════════════════════════════
// GET PAYMENT HISTORY
// ═══════════════════════════════════════════════════════════════════

export async function getPaymentHistory(loanId) {
  try {
    return await EMIPayment.find({ loanId }).sort({ emiNumber: 1 });
  } catch (error) {
    console.error('Error fetching payment history:', error.message);
    throw error;
  }
}

export default {
  createEMISchedule,
  getEMISchedule,
  checkAndMarkOverdue,
  initiateEMIPayment,
  processEMIPayment,
  getPaymentHistory,
};
