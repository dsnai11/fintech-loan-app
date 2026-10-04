import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { getRole, permissionsOf } from '../services/permissions.js';

// Who am I and what may I do: the portal uses this to build its menu, so a role change shows up without
// anyone having to sign in again.
const router = express.Router();

router.get('/', adminMiddleware, (req, res) => {
  res.json({ email: req.user.email, role: req.user.role, roleLabel: getRole(req.user.role)?.label || req.user.role, permissions: permissionsOf(req.user.role) });
});

export default router;
