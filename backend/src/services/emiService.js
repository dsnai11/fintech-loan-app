import EMIPayment from '../models/EMIPayment.js';
import Loan from '../models/Loan.js';
import User from '../models/User.js';
import axios from 'axios';

const RAZORPAY_API = 'https://api.razorpay.com/v1';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
const razorpayAuth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

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
    const startDate = loan.disbursedAt || new Date();

    let outstandingPrincipal = loan.loanAmount;
    const rate = loan.interestRate / 12 / 100;

    for (let i = 1; i <= tenure; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);

      // Calculate interest for this month
      const interestAmount = Math.round(outstandingPrincipal * rate);
      const principalAmount = monthlyEMI - interestAmount;

      await EMIPayment.create({
        loanId,
        userId: loan.userId,
        emiNumber: i,
        dueDate,
        amount: monthlyEMI,
        principalAmount,
        interestAmount,
        status: 'PENDING',
      });

      outstandingPrincipal -= principalAmount;
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

      // Calculate penalty: 2% per month or ₹500, whichever is higher
      const penalty = Math.max(emi.amount * 0.02 * Math.ceil(daysOverdue / 30), 500);

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

    const totalAmount = emi.amount + emi.penaltyApplied;

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
      amount: totalAmount,
      emiNumber,
    };
  } catch (error) {
    console.error('Error initiating EMI payment:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROCESS EMI PAYMENT (Webhook)
// ═══════════════════════════════════════════════════════════════════

export async function processEMIPayment(paymentData) {
  try {
    const { invoice_id, payment_id, status } = paymentData;

    const emi = await EMIPayment.findOne({ orderId: invoice_id });
    if (!emi) throw new Error('EMI not found');

    if (status === 'paid') {
      await EMIPayment.findByIdAndUpdate(emi._id, {
        status: 'PAID',
        paymentId: payment_id,
        paidDate: new Date(),
        paidAmount: emi.amount + emi.penaltyApplied,
      });

      // Check if all EMIs are paid
      const loan = await Loan.findById(emi.loanId);
      const allEmis = await EMIPayment.find({ loanId: emi.loanId });
      const paidEmis = allEmis.filter(e => e.status === 'PAID').length;

      if (paidEmis === allEmis.length) {
        // Loan closed
        await Loan.findByIdAndUpdate(emi.loanId, {
          status: 'closed',
          closedAt: new Date(),
        });
        console.log(`✅ Loan ${emi.loanId} fully repaid and closed`);
      }

      console.log(`✅ EMI #${emi.emiNumber} paid for loan ${emi.loanId}`);
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
