import axios from 'axios';
import Transaction from '../models/Transaction.js';
import Loan from '../models/Loan.js';

// ═══════════════════════════════════════════════════════════════════
// RAZORPAY INTEGRATION
// ═══════════════════════════════════════════════════════════════════

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
const RAZORPAY_API = 'https://api.razorpay.com/v1';

const razorpayAuth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

// ═══════════════════════════════════════════════════════════════════
// CREATE TRANSFER TO CUSTOMER BANK
// ═══════════════════════════════════════════════════════════════════

export async function initiateTransfer(loanId, loan) {
  try {
    if (!loan.bankDetails?.accountNumber || !loan.bankDetails?.ifscCode) {
      throw new Error('Bank details not available');
    }

    // Step 1: Create payout in Razorpay
    const payoutResponse = await axios.post(
      `${RAZORPAY_API}/payouts`,
      {
        account_number: process.env.RAZORPAY_ACCOUNT_ID || 'test_account',
        amount: loan.amount * 100, // Convert to paise
        currency: 'INR',
        mode: 'NEFT', // National Electronic Funds Transfer
        purpose: 'loan_disbursement',
        description: `Loan disbursement for ${loanId}`,
        receipt: `LN-${loanId}-${Date.now()}`,
        recipient: {
          account_number: loan.bankDetails.accountNumber,
          ifsc: loan.bankDetails.ifscCode,
          name: loan.bankDetails.accountHolder,
          email: loan.userId.email,
          contact: loan.userId.phone,
        },
        notes: {
          loanId: loanId.toString(),
          customerId: loan.userId._id.toString(),
          tenure: loan.tenure.toString(),
          interestRate: '15%',
        },
      },
      {
        headers: {
          'Authorization': `Basic ${razorpayAuth}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const transferId = payoutResponse.data.id;
    const status = payoutResponse.data.status; // processing, failed, reversed, completed

    // Step 2: Create transaction record
    const transaction = await Transaction.create({
      loanId,
      userId: loan.userId._id,
      type: 'DISBURSEMENT',
      amount: loan.amount,
      status: status === 'failed' ? 'FAILED' : 'PROCESSING',
      paymentGateway: 'RAZORPAY',
      transferId,
      bankDetails: {
        accountNumber: loan.bankDetails.accountNumber,
        ifscCode: loan.bankDetails.ifscCode,
        accountHolder: loan.bankDetails.accountHolder,
      },
      metadata: {
        razorpayResponse: payoutResponse.data,
        initiatedAt: new Date(),
        initiatedBy: 'admin',
      },
    });

    console.log(`✅ Disbursement initiated for loan ${loanId}: ${transferId}`);

    return {
      success: true,
      transactionId: transaction._id,
      transferId,
      status,
      amount: loan.amount,
      message: 'Disbursement initiated successfully',
    };
  } catch (error) {
    console.error(`❌ Disbursement error for loan ${loanId}:`, error.message);

    // Create failed transaction record
    await Transaction.create({
      loanId,
      userId: loan.userId._id,
      type: 'DISBURSEMENT',
      amount: loan.amount,
      status: 'FAILED',
      paymentGateway: 'RAZORPAY',
      error: error.message,
      metadata: {
        errorDetails: error.response?.data || error.message,
      },
    });

    throw new Error(`Disbursement failed: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// CHECK TRANSFER STATUS
// ═══════════════════════════════════════════════════════════════════

export async function checkTransferStatus(transferId) {
  try {
    const response = await axios.get(
      `${RAZORPAY_API}/payouts/${transferId}`,
      {
        headers: {
          'Authorization': `Basic ${razorpayAuth}`,
        },
      }
    );

    const data = response.data;

    return {
      transferId: data.id,
      status: data.status, // processing, failed, reversed, completed
      amount: data.amount / 100, // Convert from paise
      feeBreakup: data.fee_breakdown,
      narration: data.narration,
      createdAt: data.created_at,
      failureReason: data.failure_reason,
    };
  } catch (error) {
    console.error('Error checking transfer status:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// VERIFY & UPDATE TRANSACTION STATUS
// ═══════════════════════════════════════════════════════════════════

export async function verifyAndUpdateTransaction(loanId, transferId) {
  try {
    const transfer = await checkTransferStatus(transferId);

    let transactionStatus = 'PROCESSING';
    if (transfer.status === 'completed') {
      transactionStatus = 'COMPLETED';
    } else if (transfer.status === 'failed') {
      transactionStatus = 'FAILED';
    } else if (transfer.status === 'reversed') {
      transactionStatus = 'REVERSED';
    }

    // Update transaction record
    const transaction = await Transaction.findOneAndUpdate(
      { loanId, transferId },
      {
        status: transactionStatus,
        'metadata.lastCheckedAt': new Date(),
        'metadata.razorpayStatus': transfer.status,
      },
      { new: true }
    );

    // Update loan status if completed
    if (transactionStatus === 'COMPLETED') {
      await Loan.findByIdAndUpdate(loanId, {
        status: 'Active', // Loan is active, repayment starts
        disbursedAmount: transfer.amount,
        disbursedAt: new Date(),
        nextEmiDate: calculateNextEmiDate(),
      });

      console.log(`✅ Loan ${loanId} marked as Active - disbursement completed`);
    }

    return {
      loanId,
      transactionId: transaction._id,
      status: transactionStatus,
      amount: transfer.amount,
      failureReason: transfer.failureReason,
    };
  } catch (error) {
    console.error('Error verifying transaction:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// GET TRANSACTION HISTORY
// ═══════════════════════════════════════════════════════════════════

export async function getTransactionHistory(userId, loanId = null) {
  try {
    const query = { userId };
    if (loanId) query.loanId = loanId;

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .populate('loanId', 'amount tenure status');

    return transactions;
  } catch (error) {
    console.error('Error fetching transaction history:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Calculate Next EMI Date
// ═══════════════════════════════════════════════════════════════════

function calculateNextEmiDate() {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return nextMonth;
}

// ═══════════════════════════════════════════════════════════════════
// WEBHOOK HANDLER FOR RAZORPAY CALLBACKS
// ═══════════════════════════════════════════════════════════════════

export async function handlePayoutWebhook(webhookData) {
  try {
    const { event, payload } = webhookData;
    const payout = payload.payout.entity;

    if (event === 'payout.completed') {
      // Find transaction and update
      const transaction = await Transaction.findOneAndUpdate(
        { transferId: payout.id },
        {
          status: 'COMPLETED',
          'metadata.completedAt': new Date(),
          'metadata.webhookProcessed': true,
        },
        { new: true }
      );

      if (transaction) {
        // Update loan to Active
        await Loan.findByIdAndUpdate(transaction.loanId, {
          status: 'Active',
          'metadata.disbursementWebhookProcessed': true,
        });

        console.log(`✅ Webhook: Disbursement completed for loan ${transaction.loanId}`);
      }
    } else if (event === 'payout.failed') {
      const transaction = await Transaction.findOneAndUpdate(
        { transferId: payout.id },
        {
          status: 'FAILED',
          'metadata.failureReason': payout.failure_reason,
          'metadata.failedAt': new Date(),
          'metadata.webhookProcessed': true,
        },
        { new: true }
      );

      if (transaction) {
        // Revert loan to Approved status (so it can be retried)
        await Loan.findByIdAndUpdate(transaction.loanId, {
          status: 'Approved',
          'metadata.disbursementFailed': true,
        });

        console.log(`❌ Webhook: Disbursement failed for loan ${transaction.loanId}`);
      }
    }

    return { success: true, processed: true };
  } catch (error) {
    console.error('Error handling webhook:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SANDBOX MODE (For Testing Without Real API)
// ═══════════════════════════════════════════════════════════════════

export async function initiateTransferSandbox(loanId, loan) {
  try {
    // Mock transfer response
    const mockTransferId = `mock_${Date.now()}`;

    const transaction = await Transaction.create({
      loanId,
      userId: loan.userId._id,
      type: 'DISBURSEMENT',
      amount: loan.amount,
      status: 'COMPLETED', // Instant approval in sandbox
      paymentGateway: 'SANDBOX',
      transferId: mockTransferId,
      bankDetails: {
        accountNumber: loan.bankDetails.accountNumber,
        ifscCode: loan.bankDetails.ifscCode,
        accountHolder: loan.bankDetails.accountHolder,
      },
      metadata: {
        sandbox: true,
        completedAt: new Date(),
      },
    });

    // Update loan to Active immediately
    await Loan.findByIdAndUpdate(loanId, {
      status: 'Active',
      disbursedAmount: loan.amount,
      disbursedAt: new Date(),
      nextEmiDate: calculateNextEmiDate(),
    });

    console.log(`✅ [SANDBOX] Disbursement completed for loan ${loanId}`);

    return {
      success: true,
      transactionId: transaction._id,
      transferId: mockTransferId,
      status: 'COMPLETED',
      amount: loan.amount,
      message: '[SANDBOX MODE] Disbursement completed',
    };
  } catch (error) {
    console.error(`❌ Sandbox disbursement error:`, error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXPORT CONTROL
// ═══════════════════════════════════════════════════════════════════

export const PaymentService = {
  initiateTransfer: process.env.PAYMENT_MODE === 'SANDBOX' ? initiateTransferSandbox : initiateTransfer,
  checkTransferStatus,
  verifyAndUpdateTransaction,
  getTransactionHistory,
  handlePayoutWebhook,
};

export default PaymentService;
