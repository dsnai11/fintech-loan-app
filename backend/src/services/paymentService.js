import axios from 'axios';
import Transaction from '../models/Transaction.js';
import Loan from '../models/Loan.js';
import { createEMISchedule } from './emiService.js';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

const isProduction = () => process.env.PAYMENT_MODE === 'PRODUCTION';

const razorpayAuth = () =>
  Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');

function nextMonthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

async function markLoanDisbursed(loanId, amount, transferId, adminEmail) {
  const loan = await Loan.findByIdAndUpdate(
    loanId,
    {
      status: 'disbursed',
      disbursedBy: adminEmail,
      disbursedAmount: amount,
      disbursementDate: new Date(),
      transactionId: transferId,
      nextEmiDate: nextMonthStart(),
    },
    { new: true }
  );
  const existing = await import('../models/EMIPayment.js').then(m => m.default.countDocuments({ loanId }));
  if (!existing) await createEMISchedule(loan._id);
}

function bankOf(loan) {
  const bank = loan.userId?.bankAccount;
  if (!bank?.accountNumber || !bank?.ifscCode) {
    throw new Error('Customer bank details are missing');
  }
  return bank;
}

export async function initiateTransfer(loanId, loan, adminEmail = 'admin') {
  const bank = bankOf(loan);
  const bankDetails = {
    accountNumber: bank.accountNumber,
    ifscCode: bank.ifscCode,
    accountHolder: bank.accountHolder,
    bankName: bank.bankName,
  };
  const base = {
    loanId,
    userId: loan.userId._id,
    type: 'DISBURSEMENT',
    amount: loan.loanAmount,
    bankDetails,
  };

  if (!isProduction()) {
    const transferId = `sandbox_${Date.now()}`;
    await Transaction.create({
      ...base,
      status: 'COMPLETED',
      paymentGateway: 'SANDBOX',
      transferId,
      metadata: { sandbox: true, initiatedBy: adminEmail, initiatedAt: new Date(), completedAt: new Date() },
    });
    await markLoanDisbursed(loanId, loan.loanAmount, transferId, adminEmail);
    return { status: 'COMPLETED', transferId, amount: loan.loanAmount };
  }

  try {
    const res = await axios.post(
      `${RAZORPAY_API}/payouts`,
      {
        account_number: process.env.RAZORPAY_ACCOUNT_ID,
        amount: Math.round(loan.loanAmount * 100),
        currency: 'INR',
        mode: 'NEFT',
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: `LN-${loanId}`,
        narration: 'Loan disbursement',
        fund_account: {
          account_type: 'bank_account',
          bank_account: { name: bank.accountHolder, ifsc: bank.ifscCode, account_number: bank.accountNumber },
          contact: {
            name: `${loan.userId.firstName} ${loan.userId.lastName}`,
            email: loan.userId.email,
            contact: loan.userId.phone,
            type: 'customer',
          },
        },
      },
      { headers: { Authorization: `Basic ${razorpayAuth()}`, 'Content-Type': 'application/json' } }
    );

    await Transaction.create({
      ...base,
      status: 'PROCESSING',
      paymentGateway: 'RAZORPAY',
      transferId: res.data.id,
      metadata: { razorpayResponse: res.data, initiatedBy: adminEmail, initiatedAt: new Date() },
    });
    return { status: 'PROCESSING', transferId: res.data.id, amount: loan.loanAmount };
  } catch (error) {
    await Transaction.create({
      ...base,
      status: 'FAILED',
      paymentGateway: 'RAZORPAY',
      error: error.response?.data?.error?.description || error.message,
    });
    throw new Error(`Disbursement failed: ${error.response?.data?.error?.description || error.message}`);
  }
}

export async function checkTransferStatus(transferId) {
  const res = await axios.get(`${RAZORPAY_API}/payouts/${transferId}`, {
    headers: { Authorization: `Basic ${razorpayAuth()}` },
  });
  return { transferId: res.data.id, status: res.data.status, failureReason: res.data.failure_reason };
}

export async function verifyAndUpdateTransaction(loanId, transferId) {
  const transfer = await checkTransferStatus(transferId);
  const map = { processed: 'COMPLETED', completed: 'COMPLETED', failed: 'FAILED', rejected: 'FAILED', reversed: 'REVERSED' };
  const status = map[transfer.status] || 'PROCESSING';

  const tx = await Transaction.findOneAndUpdate(
    { loanId, transferId },
    { status, 'metadata.lastCheckedAt': new Date(), 'metadata.razorpayStatus': transfer.status },
    { new: true }
  );
  if (status === 'COMPLETED') await markLoanDisbursed(loanId, tx.amount, transferId, tx.metadata?.initiatedBy);
  return { loanId, transactionId: tx._id, status, amount: tx.amount, failureReason: transfer.failureReason };
}

export async function getTransactionHistory(userId, loanId = null) {
  const query = { userId };
  if (loanId) query.loanId = loanId;
  return Transaction.find(query).sort({ createdAt: -1 }).populate('loanId', 'loanAmount tenure status');
}

export async function handlePayoutWebhook({ event, payload }) {
  const payout = payload.payout.entity;
  const tx = await Transaction.findOne({ transferId: payout.id });
  if (!tx) return { success: true, processed: false };

  if (event === 'payout.processed' || event === 'payout.completed') {
    tx.status = 'COMPLETED';
    tx.metadata.completedAt = new Date();
    tx.metadata.webhookProcessed = true;
    await tx.save();
    await markLoanDisbursed(tx.loanId, tx.amount, payout.id, tx.metadata?.initiatedBy);
  } else if (event === 'payout.failed' || event === 'payout.rejected') {
    tx.status = 'FAILED';
    tx.metadata.failureReason = payout.failure_reason;
    tx.metadata.failedAt = new Date();
    tx.metadata.webhookProcessed = true;
    await tx.save();
  }
  return { success: true, processed: true };
}

export const PaymentService = {
  initiateTransfer,
  checkTransferStatus,
  verifyAndUpdateTransaction,
  getTransactionHistory,
  handlePayoutWebhook,
};

export default PaymentService;
