import express from 'express';
import Role from '../models/Role.js';
import User from '../models/User.js';
import { adminMiddleware } from '../middleware/auth.js';
import { PERMISSIONS, DEFAULT_ROLES, isPermission, SUPER_ONLY, listRoles, refreshRoles } from '../services/permissions.js';
import { audit } from '../services/auditService.js';

// Edit what each role may do, and create new roles. Super admin only: a role that could edit roles could
// give itself anything.
const router = express.Router();
router.use(adminMiddleware);

const bad = (res, status, error) => res.status(status).json({ error });
const slug = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

function cleanPermissions(input) {
  if (!Array.isArray(input)) return { error: 'Permissions must be a list' };
  const out = [...new Set(input.map(String))];
  const unknown = out.filter(p => !isPermission(p));
  if (unknown.length) return { error: `Unknown permission: ${unknown[0]}` };
  if (out.some(p => SUPER_ONLY.includes(p))) return { error: 'That permission cannot be given to a role' };
  return { permissions: out };
}

router.get('/', async (req, res) => {
  try {
    await refreshRoles();
    const counts = await User.aggregate([{ $match: { role: { $nin: ['customer', null] } } }, { $group: { _id: '$role', n: { $sum: 1 } } }]);
    const byRole = Object.fromEntries(counts.map(c => [c._id, c.n]));
    res.json({
      permissions: PERMISSIONS,
      roles: listRoles().map(r => ({ key: r.key, label: r.label, description: r.description, permissions: r.permissions, builtin: r.builtin, people: byRole[r.key] || 0, locked: r.key === 'super_admin' })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const label = String(req.body?.label || '').trim().slice(0, 60);
    const key = slug(req.body?.key || label);
    if (!label) return bad(res, 400, 'Give the role a name');
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) return bad(res, 400, 'The role name must start with a letter');
    if (key === 'super_admin' || key === 'customer' || (await Role.exists({ key }))) return bad(res, 409, 'A role with that name already exists');
    const p = cleanPermissions(req.body?.permissions || []);
    if (p.error) return bad(res, 400, p.error);
    const role = await Role.create({ key, label, description: String(req.body?.description || '').trim().slice(0, 300), permissions: p.permissions, builtin: false, updatedBy: req.user.email });
    await refreshRoles();
    await audit(req.user, 'ROLE_CREATED', { type: 'Role', id: key }, { label, permissions: p.permissions }, req);
    res.status(201).json({ role });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:key', async (req, res) => {
  try {
    if (req.params.key === 'super_admin') return bad(res, 403, 'The super admin role is fixed');
    const role = await Role.findOne({ key: req.params.key });
    if (!role) return bad(res, 404, 'Role not found');
    const before = { label: role.label, permissions: [...role.permissions] };
    if (req.body?.label !== undefined) {
      const label = String(req.body.label).trim().slice(0, 60);
      if (!label) return bad(res, 400, 'Give the role a name');
      role.label = label;
    }
    if (req.body?.description !== undefined) role.description = String(req.body.description).trim().slice(0, 300);
    if (req.body?.permissions !== undefined) {
      const p = cleanPermissions(req.body.permissions);
      if (p.error) return bad(res, 400, p.error);
      role.permissions = p.permissions;
    }
    role.updatedBy = req.user.email;
    await role.save();
    await refreshRoles();
    const added = role.permissions.filter(p => !before.permissions.includes(p));
    const removed = before.permissions.filter(p => !role.permissions.includes(p));
    await audit(req.user, 'ROLE_UPDATED', { type: 'Role', id: role.key }, { label: role.label, added, removed }, req);
    res.json({ role });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Put a built-in role back to its original permissions
router.post('/:key/reset', async (req, res) => {
  try {
    const def = DEFAULT_ROLES[req.params.key];
    if (!def || req.params.key === 'super_admin') return bad(res, 400, 'Only the built-in roles can be reset');
    await Role.updateOne({ key: req.params.key }, { label: def.label, description: def.description, permissions: def.permissions, updatedBy: req.user.email });
    await refreshRoles();
    await audit(req.user, 'ROLE_RESET', { type: 'Role', id: req.params.key }, {}, req);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:key', async (req, res) => {
  try {
    const role = await Role.findOne({ key: req.params.key });
    if (!role) return bad(res, 404, 'Role not found');
    if (role.builtin) return bad(res, 400, 'Built-in roles cannot be deleted. Remove their permissions instead.');
    const people = await User.countDocuments({ role: role.key });
    if (people) return bad(res, 409, `${people} staff member(s) still have this role. Move them to another role first.`);
    await role.deleteOne();
    await refreshRoles();
    await audit(req.user, 'ROLE_DELETED', { type: 'Role', id: role.key }, { label: role.label }, req);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
