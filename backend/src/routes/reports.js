import express from 'express';
import Loan from '../models/Loan.js';
import EMIPayment from '../models/EMIPayment.js';
import { adminMiddleware } from '../middleware/auth.js';

const router = express.Router();
router.use(adminMiddleware);

const DAY = 24 * 60 * 60 * 1000;
const REPAYING = ['disbursed', 'closed'];
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function lastMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  return out;
}

async function monthlySeries(model, dateField, valueExpr, match, months) {
  const rows = await model.aggregate([
    { $match: { ...match, [dateField]: { $gte: new Date(`${months[0]}-01T00:00:00`) } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: `$${dateField}` } }, count: { $sum: 1 }, amount: { $sum: valueExpr } } },
  ]);
  const byMonth = Object.fromEntries(rows.map(r => [r._id, r]));
  return months.map(m => ({ month: m, count: byMonth[m]?.count || 0, amount: byMonth[m]?.amount || 0 }));
}

router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const months = lastMonths(6);

    const byStatus = await Loan.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$loanAmount' } } }]);
    const status = Object.fromEntries(byStatus.map(s => [s._id, { count: s.count, amount: s.amount }]));
    const count = k => status[k]?.count || 0;

    const repaying = byStatus.filter(s => REPAYING.includes(s._id));
    const totalDisbursed = repaying.reduce((a, s) => a + s.amount, 0);
    const disbursedLoans = repaying.reduce((a, s) => a + s.count, 0);
    const totalLoans = byStatus.reduce((a, s) => a + s.count, 0);
    const decided = count('approved') + disbursedLoans + count('rejected');

    const [paid] = await EMIPayment.aggregate([
      { $match: { status: 'PAID' } },
      { $group: { _id: null, principal: { $sum: '$principalAmount' }, interest: { $sum: '$interestAmount' }, penalties: { $sum: '$penaltyApplied' }, collected: { $sum: '$paidAmount' } } },
    ]);
    const [unpaid] = await EMIPayment.aggregate([
      { $match: { status: { $in: ['PENDING', 'OVERDUE', 'FAILED'] } } },
      { $group: { _id: null, principal: { $sum: '$principalAmount' }, amount: { $sum: '$amount' } } },
    ]);

    const pastDue = await EMIPayment.find({ status: { $in: ['PENDING', 'OVERDUE', 'FAILED'] }, dueDate: { $lt: now } }).select('loanId amount principalAmount dueDate');
    const worstAge = new Map();
    let overdueAmount = 0;
    for (const e of pastDue) {
      overdueAmount += e.amount;
      const age = Math.floor((now - e.dueDate) / DAY);
      const k = String(e.loanId);
      worstAge.set(k, Math.max(worstAge.get(k) || 0, age));
    }
    const ages = [...worstAge.values()];
    const dueOrPast = await EMIPayment.countDocuments({ dueDate: { $lt: now } });

    const geography = await Loan.aggregate([
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u' } },
      { $addFields: { state: { $ifNull: [{ $arrayElemAt: ['$u.address.state', 0] }, 'Not provided'] } } },
      { $group: { _id: '$state', count: { $sum: 1 }, amount: { $sum: '$loanAmount' } } },
      { $sort: { amount: -1 } },
      { $limit: 10 },
    ]);

    const [applications, disbursedTrend, collections] = await Promise.all([
      monthlySeries(Loan, 'createdAt', '$loanAmount', {}, months),
      monthlySeries(Loan, 'disbursementDate', '$disbursedAmount', { status: { $in: REPAYING } }, months),
      monthlySeries(EMIPayment, 'paidDate', '$paidAmount', { status: 'PAID' }, months),
    ]);

    const pct = (a, b) => (b ? +((a / b) * 100).toFixed(1) : 0);
    res.json({
      generatedAt: now,
      portfolio: {
        totalLoans,
        status,
        totalDisbursed,
        outstandingPrincipal: unpaid?.principal || 0,
        averageTicket: disbursedLoans ? Math.round(totalDisbursed / disbursedLoans) : 0,
        approvalRate: pct(count('approved') + disbursedLoans, decided),
      },
      revenue: {
        interestCollected: paid?.interest || 0,
        penaltiesCollected: paid?.penalties || 0,
        principalRecovered: paid?.principal || 0,
        totalCollected: paid?.collected || 0,
      },
      risk: {
        overdueAmount,
        overdueEmiRate: pct(pastDue.length, dueOrPast),
        loansPastDue: ages.length,
        loans30Plus: ages.filter(a => a >= 30).length,
        loans90Plus: ages.filter(a => a >= 90).length,
        defaultRate90: pct(ages.filter(a => a >= 90).length, disbursedLoans),
      },
      trend: months.map((m, i) => ({
        month: m,
        applications: applications[i].count,
        applied: applications[i].amount,
        disbursed: disbursedTrend[i].amount,
        collected: collections[i].amount,
      })),
      geography: geography.map(g => ({ state: g._id, loans: g.count, amount: g.amount })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CSV cells beginning with = + - @ are prefixed so spreadsheets don't run them as formulas.
const cell = v => {
  let s = v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
const toCsv = (header, rows) => [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n');

router.get('/export', async (req, res) => {
  try {
    const { type = 'loans', month } = req.query;
    if (!['loans', 'emis'].includes(type)) return res.status(400).json({ error: 'type must be loans or emis' });
    let range = null;
    if (month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
      const start = new Date(`${month}-01T00:00:00`);
      range = { $gte: start, $lt: new Date(start.getFullYear(), start.getMonth() + 1, 1) };
    }

    let csv;
    if (type === 'loans') {
      const loans = await Loan.find(range ? { createdAt: range } : {}).sort({ createdAt: -1 }).populate('userId', 'firstName lastName email phone address.state');
      csv = toCsv(
        ['Loan ID', 'Applied', 'Customer', 'Email', 'Phone', 'State', 'Amount', 'Tenure (months)', 'Rate %', 'Monthly EMI', 'Status', 'Disbursed on'],
        loans.map(l => [l._id, l.createdAt, `${l.userId?.firstName || ''} ${l.userId?.lastName || ''}`.trim(), l.userId?.email, l.userId?.phone, l.userId?.address?.state, l.loanAmount, l.tenure, l.interestRate, l.monthlyEMI, l.status, l.disbursementDate])
      );
    } else {
      const emis = await EMIPayment.find(range ? { dueDate: range } : {}).sort({ dueDate: 1 }).populate('userId', 'firstName lastName email phone');
      csv = toCsv(
        ['Loan ID', 'EMI #', 'Customer', 'Phone', 'Due date', 'EMI amount', 'Principal', 'Interest', 'Late fee', 'Status', 'Paid on', 'Paid amount'],
        emis.map(e => [e.loanId, e.emiNumber, `${e.userId?.firstName || ''} ${e.userId?.lastName || ''}`.trim(), e.userId?.phone, e.dueDate, e.amount, e.principalAmount, e.interestAmount, e.penaltyApplied, e.status, e.paidDate, e.paidAmount])
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-${month || 'all'}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
