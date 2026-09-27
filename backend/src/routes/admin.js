import express from 'express';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import { adminMiddleware } from '../middleware/auth.js';
import { getConfig } from '../services/configService.js';

const router = express.Router();

// GET /api/admin/users
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    const total = await User.countDocuments();
    res.json({ users, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/loans
router.get('/loans', adminMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = status ? { status } : {};
    const loans = await Loan.find(filter)
      .populate('userId', 'firstName lastName email phone panNumber kycStatus')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    const total = await Loan.countDocuments(filter);
    res.json({ loans, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/stats
router.get('/stats', adminMiddleware, async (req, res) => {
  try {
    const [totalLoans, disbursed, pending, totalUsers] = await Promise.all([
      Loan.countDocuments(),
      Loan.countDocuments({ status: 'disbursed' }),
      Loan.countDocuments({ status: { $in: ['submitted', 'under_review'] } }),
      User.countDocuments(),
    ]);
    const pipeline = await Loan.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const byStatus = Object.fromEntries(pipeline.map(p => [p._id, p.count]));
    res.json({ totalLoans, disbursed, pending, totalUsers, byStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/loans/:id/status
router.put('/loans/:id/status', adminMiddleware, async (req, res) => {
  try {
    const { status, notes, rejectionReason } = req.body;
    const allowed = ['under_review', 'approved', 'rejected', 'disbursed', 'closed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
    }

    const update = { status };
    if (status === 'approved') update.approvalDate = new Date();
    if (status === 'disbursed') {
      update.disbursementDate = new Date();
      update['disbursalDetails.transactionId'] = `TXN${Date.now()}`;
      update['disbursalDetails.disbursalDate'] = new Date();
    }
    if (notes) update.approvalNotes = notes;
    if (rejectionReason) update.rejectionReason = rejectionReason;

    const loan = await Loan.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('userId', 'firstName lastName email phone');
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    res.json({ message: `Loan ${status}`, loan });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/users/:id/status
router.put('/users/:id/status', adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive', 'blocked'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User status updated', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/builds — fetch GitHub Actions latest builds + artifact download links
router.get('/builds', adminMiddleware, async (req, res) => {
  try {
    const ghToken = getConfig('GITHUB_TOKEN');
    const ghRepo  = getConfig('GITHUB_REPO'); // e.g. "dsnai11/fintech-loan-app"
    if (!ghRepo) return res.json({ builds: [], error: 'GITHUB_REPO not configured' });

    const headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(ghToken ? { 'Authorization': `Bearer ${ghToken}` } : {}),
    };

    // Get latest workflow runs (last 20)
    const runsRes = await fetch(`https://api.github.com/repos/${ghRepo}/actions/runs?per_page=15`, { headers });
    if (!runsRes.ok) {
      const err = await runsRes.json().catch(() => ({}));
      return res.json({ builds: [], error: err.message || `GitHub API error ${runsRes.status}` });
    }
    const { workflow_runs: runs } = await runsRes.json();

    // For the most recent run per workflow, fetch its artifacts
    const seen = new Set();
    const latest = [];
    for (const run of (runs || [])) {
      if (!seen.has(run.name)) { seen.add(run.name); latest.push(run); }
      if (latest.length >= 5) break;
    }

    const builds = await Promise.all(latest.map(async run => {
      let artifacts = [];
      if (run.status === 'completed' && run.conclusion === 'success') {
        const artRes = await fetch(`https://api.github.com/repos/${ghRepo}/actions/runs/${run.id}/artifacts`, { headers })
          .then(r => r.json()).catch(() => ({ artifacts: [] }));
        artifacts = (artRes.artifacts || []).map(a => ({
          name: a.name,
          sizeKb: Math.round(a.size_in_bytes / 1024),
          downloadUrl: `https://github.com/${ghRepo}/suites/${run.check_suite_id}/artifacts/${a.id}`,
          apiDownloadUrl: a.archive_download_url,
          expiresAt: a.expires_at,
        }));
      }
      return {
        id: run.id,
        name: run.name,
        branch: run.head_branch,
        commit: run.head_sha?.slice(0, 7),
        commitMsg: run.head_commit?.message?.split('\n')[0] || '',
        status: run.status,
        conclusion: run.conclusion,
        startedAt: run.run_started_at,
        updatedAt: run.updated_at,
        durationMs: run.updated_at && run.run_started_at
          ? new Date(run.updated_at) - new Date(run.run_started_at) : null,
        htmlUrl: run.html_url,
        artifacts,
      };
    }));

    res.json({ builds, repo: ghRepo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
