import Role from '../models/Role.js';

// Who may do what.
//   - PERMISSIONS is the catalogue of things a role can be allowed to do.
//   - Roles (which permissions each one has) live in the database, so the super admin can edit them and add
//     new ones. DEFAULT_ROLES only seeds the database the first time.
//   - RULES maps every admin route to the permission it needs. A route with no rule is super-admin only, so a
//     new admin route stays locked until someone decides who should use it.

export const PERMISSIONS = [
  { key: 'loans.view', group: 'Loans', label: 'See loan applications and loans' },
  { key: 'loans.approve', group: 'Loans', label: 'Approve or reject loans' },
  { key: 'loans.disburse', group: 'Loans', label: 'Release payouts' },
  { key: 'customers.view', group: 'Customers', label: 'Search and view customers' },
  { key: 'customers.reset', group: 'Customers', label: 'Create password reset links for customers' },
  { key: 'kyc.view', group: 'Compliance', label: 'See KYC reviews' },
  { key: 'kyc.decide', group: 'Compliance', label: 'Approve or reject KYC' },
  { key: 'aml.view', group: 'Compliance', label: 'See AML alerts and the watchlist' },
  { key: 'aml.review', group: 'Compliance', label: 'Clear or escalate AML alerts, edit the watchlist' },
  { key: 'audit.view', group: 'Compliance', label: 'Read and export the audit log' },
  { key: 'requests.process', group: 'Compliance', label: 'Handle customer data export and deletion requests' },
  { key: 'collections.view', group: 'Collections', label: 'See the overdue queue and promises' },
  { key: 'collections.act', group: 'Collections', label: 'Take cases, log calls and notes, make letters' },
  { key: 'collections.manage', group: 'Collections', label: 'Assign cases, mark default, write off, record recoveries' },
  { key: 'reports.view', group: 'Reports', label: 'See analytics and reports' },
  { key: 'pricing.view', group: 'Pricing and controls', label: 'See rates, fees and lender details' },
  { key: 'pricing.edit', group: 'Pricing and controls', label: 'Change rates, fees, limits, plans and lender details' },
  { key: 'controls.edit', group: 'Pricing and controls', label: 'Change internal controls (four-eyes, repeat-customer limits)' },
  { key: 'staff.manage', group: 'Administration', label: 'Add staff and change their access (only up to your own level)' },
  { key: 'config.manage', group: 'Administration', label: 'Change app configuration and integrations' },
];
const CATALOG = new Set(PERMISSIONS.map(p => p.key));
export const isPermission = p => CATALOG.has(p);

// Never granted to anyone but the super admin: it would let a role grant itself anything.
export const SUPER_ONLY = ['roles.manage'];

export const DEFAULT_ROLES = {
  super_admin: { label: 'Super admin', description: 'Everything, including editing roles. Fixed.', permissions: ['*'] },
  credit_officer: { label: 'Credit officer', description: 'Reviews and approves loans.', permissions: ['loans.view', 'loans.approve', 'customers.view', 'reports.view', 'pricing.view'] },
  kyc_reviewer: { label: 'KYC reviewer', description: 'Checks customer identity documents.', permissions: ['kyc.view', 'kyc.decide', 'aml.view', 'customers.view'] },
  collections_agent: { label: 'Collections agent', description: 'Follows up on overdue loans.', permissions: ['collections.view', 'collections.act', 'customers.view', 'loans.view'] },
  collections_manager: { label: 'Collections manager', description: 'Runs the collections team.', permissions: ['collections.view', 'collections.act', 'collections.manage', 'customers.view', 'loans.view', 'reports.view'] },
  finance: { label: 'Finance', description: 'Releases approved payouts.', permissions: ['loans.view', 'loans.disburse', 'customers.view', 'reports.view', 'pricing.view'] },
  compliance_officer: { label: 'Compliance officer', description: 'AML, audit and data requests.', permissions: ['kyc.view', 'aml.view', 'aml.review', 'audit.view', 'requests.process', 'customers.view', 'customers.reset', 'reports.view'] },
  auditor: { label: 'Auditor (read only)', description: 'Can look, cannot change.', permissions: ['loans.view', 'customers.view', 'audit.view', 'reports.view', 'pricing.view', 'aml.view', 'kyc.view', 'collections.view'] },
};

// ── Role cache ────────────────────────────────────────────────────────────────────────────────
// Read from the database at most every few seconds. Changes made on this server apply at once; other
// servers pick them up within the cache time.
const TTL_MS = (Number(process.env.ROLE_CACHE_SECONDS) || 15) * 1000;
let roles = new Map(Object.entries(DEFAULT_ROLES).map(([key, r]) => [key, { key, ...r, builtin: true }]));
let loadedAt = 0;
let loading = null;

async function seedAndLoad() {
  for (const [key, r] of Object.entries(DEFAULT_ROLES)) {
    if (key === 'super_admin') continue;
    await Role.updateOne({ key }, { $setOnInsert: { key, label: r.label, description: r.description, permissions: r.permissions, builtin: true } }, { upsert: true });
  }
  const rows = await Role.find().lean();
  const next = new Map([['super_admin', { key: 'super_admin', ...DEFAULT_ROLES.super_admin, builtin: true }]]);
  for (const r of rows) if (r.key !== 'super_admin') next.set(r.key, { key: r.key, label: r.label, description: r.description, permissions: r.permissions, builtin: !!r.builtin });
  roles = next;
  loadedAt = Date.now();
}

export async function ensureRoles(force = false) {
  if (!force && Date.now() - loadedAt < TTL_MS) return;
  if (!loading) loading = seedAndLoad().catch(e => console.error('Could not load roles:', e.message)).finally(() => { loading = null; });
  await loading;
}
export const refreshRoles = () => ensureRoles(true);

export const getRole = key => roles.get(key) || null;
export const listRoles = () => [...roles.values()];
export const isStaffRole = role => roles.has(role);
export const permissionsOf = role => roles.get(role)?.permissions || [];

export function can(role, permission) {
  const grants = permissionsOf(role);
  return grants.includes('*') || grants.includes(permission);
}

// True when everything `inner` can do, `outer` can do too.
export function isSubset(innerRole, outerRole) {
  const outer = permissionsOf(outerRole);
  if (outer.includes('*')) return true;
  const inner = permissionsOf(innerRole);
  if (inner.includes('*')) return false;
  return inner.every(p => outer.includes(p));
}

const READ = m => m === 'GET' || m === 'HEAD';
const SUPER = 'super';
const ANY = 'any'; // any signed-in staff member

// [path pattern, permission for reads, permission for everything else]. First match wins.
const RULES = [
  [/^\/api\/admin\/me(\/|$)/, ANY, ANY],
  [/^\/api\/admin\/roles(\/|$)/, SUPER, SUPER],
  [/^\/api\/admin\/staff(\/|$)/, 'staff.manage', 'staff.manage'],
  [/^\/api\/admin\/config(\/|$)/, 'config.manage', 'config.manage'],
  [/^\/api\/app-config\/admin(\/|$)/, 'config.manage', 'config.manage'],
  [/^\/api\/admin\/builds(\/|$)/, 'config.manage', 'config.manage'],
  [/^\/api\/admin\/pricing(\/|$)/, 'pricing.view', 'pricing.view'], // PUT is checked by what it changes
  [/^\/api\/admin\/customers(\/|$)/, 'customers.view', 'customers.view'],
  [/^\/api\/admin\/reports(\/|$)/, 'reports.view', 'reports.view'],
  [/^\/api\/admin\/collections\/[^/]+\/(letter|claim|release)(\/|$)/, 'collections.act', 'collections.act'],
  [/^\/api\/admin\/collections\/(run-escalations|[^/]+\/(default|write-off|recovery|assign))(\/|$)/, 'collections.view', 'collections.manage'],
  [/^\/api\/admin\/collections(\/|$)/, 'collections.view', 'collections.act'],
  [/^\/api\/admin\/compliance\/audit(\/|$)/, 'audit.view', 'audit.view'],
  [/^\/api\/admin\/compliance\/kyc(\/|$)/, 'kyc.view', 'kyc.decide'],
  [/^\/api\/admin\/compliance\/aml(\/|$)/, 'aml.view', 'aml.review'],
  [/^\/api\/admin\/compliance\/customers\/reset-link(\/|$)/, 'customers.reset', 'customers.reset'],
  [/^\/api\/admin\/compliance\/requests(\/|$)/, 'requests.process', 'requests.process'],
  [/^\/api\/admin\/loans\/analytics(\/|$)/, 'reports.view', 'reports.view'],
  [/^\/api\/admin\/loans\/[^/]+\/disburse(\/|$)/, 'loans.view', 'loans.disburse'],
  [/^\/api\/admin\/loans\/[^/]+\/(approve|reject)(\/|$)/, 'loans.view', 'loans.approve'],
  [/^\/api\/admin\/loans\/[^/]+\/status(\/|$)/, 'loans.view', 'loans.approve'],
  [/^\/api\/admin\/loans(\/|$)/, 'loans.view', SUPER],
  [/^\/api\/admin\/users\/[^/]+\/status(\/|$)/, SUPER, SUPER],
  [/^\/api\/admin\/users(\/|$)/, 'customers.view', SUPER],
  [/^\/api\/admin\/stats(\/|$)/, 'reports.view', 'reports.view'],
  [/^\/api\/payments\/(disburse|retry)\//, 'loans.view', 'loans.disburse'],
  [/^\/api\/payments\/status\//, 'loans.view', 'loans.view'],
  [/^\/api\/payments\/analytics(\/|$)/, 'reports.view', 'reports.view'],
  [/^\/api\/emi\/admin\/check-overdue(\/|$)/, 'collections.manage', 'collections.manage'],
  [/^\/api\/emi\/admin(\/|$)/, 'reports.view', 'reports.view'],
  [/^\/api\/notifications\/admin(\/|$)/, 'collections.manage', 'collections.manage'],
];

// The permission needed for this request ('super' = super admin only, 'any' = any staff).
export function permissionFor(method, fullPath) {
  const path = String(fullPath).split('?')[0];
  for (const [re, read, write] of RULES) if (re.test(path)) return READ(method) ? read : write;
  return SUPER;
}

export function allowed(role, method, fullPath) {
  const need = permissionFor(method, fullPath);
  if (role === 'super_admin') return { ok: true, need };
  if (need === ANY) return { ok: true, need };
  return { ok: need !== SUPER && can(role, need), need };
}

export default { PERMISSIONS, DEFAULT_ROLES, ensureRoles, refreshRoles, getRole, listRoles, isStaffRole, permissionsOf, can, isSubset, permissionFor, allowed };
