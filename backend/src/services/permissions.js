// Who may do what. Every admin route is matched against RULES below; a route with no rule is open to the
// super admin only, so a new admin route is locked until someone decides who should use it.

export const ROLES = {
  super_admin: { label: 'Super admin', can: ['*'] },
  credit_officer: { label: 'Credit officer', can: ['loans.view', 'loans.approve', 'customers.view', 'reports.view', 'pricing.view'] },
  kyc_reviewer: { label: 'KYC reviewer', can: ['kyc.view', 'kyc.decide', 'aml.view', 'customers.view'] },
  collections_agent: { label: 'Collections agent', can: ['collections.view', 'collections.act', 'customers.view', 'loans.view'] },
  collections_manager: { label: 'Collections manager', can: ['collections.view', 'collections.act', 'collections.manage', 'customers.view', 'loans.view', 'reports.view'] },
  finance: { label: 'Finance', can: ['loans.view', 'loans.disburse', 'customers.view', 'reports.view', 'pricing.view'] },
  compliance_officer: { label: 'Compliance officer', can: ['kyc.view', 'aml.view', 'aml.review', 'audit.view', 'requests.process', 'customers.view', 'customers.reset', 'reports.view'] },
  auditor: { label: 'Auditor (read only)', can: ['loans.view', 'customers.view', 'audit.view', 'reports.view', 'pricing.view', 'aml.view', 'kyc.view', 'collections.view'] },
};

export const STAFF_ROLES = Object.keys(ROLES);
export const isStaffRole = role => STAFF_ROLES.includes(role);

export function can(role, permission) {
  const grants = ROLES[role]?.can || [];
  return grants.includes('*') || grants.includes(permission);
}

const READ = m => m === 'GET' || m === 'HEAD';
const SUPER = 'super';

// [path pattern, permission for reads, permission for everything else]. First match wins.
const RULES = [
  [/^\/api\/admin\/staff(\/|$)/, SUPER, SUPER],
  [/^\/api\/admin\/config(\/|$)/, SUPER, SUPER],
  [/^\/api\/app-config\/admin(\/|$)/, SUPER, SUPER],
  [/^\/api\/admin\/builds(\/|$)/, SUPER, SUPER],
  [/^\/api\/admin\/pricing(\/|$)/, 'pricing.view', 'pricing.edit'],
  [/^\/api\/admin\/customers(\/|$)/, 'customers.view', 'customers.view'],
  [/^\/api\/admin\/reports(\/|$)/, 'reports.view', 'reports.view'],
  [/^\/api\/admin\/collections\/[^/]+\/(letter|claim|release)(\/|$)/, 'collections.act', 'collections.act'],
  [/^\/api\/admin\/collections\/(run-escalations|[^/]+\/(default|write-off|recovery|assign))(\/|$)/, 'collections.view', 'collections.manage'],
  [/^\/api\/admin\/collections(\/|$)/, 'collections.view', 'collections.act'],
  [/^\/api\/admin\/compliance\/audit(\/|$)/, 'audit.view', 'audit.view'],
  [/^\/api\/admin\/compliance\/kyc(\/|$)/, 'kyc.view', 'kyc.decide'],
  [/^\/api\/admin\/compliance\/aml\/watchlist(\/|$)/, 'aml.view', 'aml.review'],
  [/^\/api\/admin\/compliance\/aml(\/|$)/, 'aml.view', 'aml.review'],
  [/^\/api\/admin\/compliance\/customers\/reset-link(\/|$)/, 'customers.reset', 'customers.reset'],
  [/^\/api\/admin\/compliance\/requests(\/|$)/, 'requests.process', 'requests.process'],
  [/^\/api\/admin\/loans\/analytics(\/|$)/, 'reports.view', 'reports.view'],
  [/^\/api\/admin\/loans\/[^/]+\/disburse(\/|$)/, 'loans.view', 'loans.disburse'],
  [/^\/api\/admin\/loans\/[^/]+\/(approve|reject)(\/|$)/, 'loans.view', 'loans.approve'],
  [/^\/api\/admin\/loans(\/|$)/, 'loans.view', SUPER],
  [/^\/api\/admin\/users\/[^/]+\/status(\/|$)/, SUPER, SUPER],
  [/^\/api\/admin\/users(\/|$)/, 'customers.view', SUPER],
  [/^\/api\/admin\/stats(\/|$)/, 'reports.view', 'reports.view'],
  [/^\/api\/admin\/loans\/[^/]+\/status(\/|$)/, 'loans.view', 'loans.approve'],
  [/^\/api\/payments\/(disburse|retry)\//, 'loans.view', 'loans.disburse'],
  [/^\/api\/payments\/status\//, 'loans.view', 'loans.view'],
  [/^\/api\/payments\/analytics(\/|$)/, 'reports.view', 'reports.view'],
  [/^\/api\/emi\/admin\/check-overdue(\/|$)/, 'collections.manage', 'collections.manage'],
  [/^\/api\/emi\/admin(\/|$)/, 'reports.view', 'reports.view'],
  [/^\/api\/notifications\/admin(\/|$)/, 'collections.manage', 'collections.manage'],
];

// The permission needed for this request ('super' = super admin only).
export function permissionFor(method, fullPath) {
  const path = String(fullPath).split('?')[0];
  for (const [re, read, write] of RULES) if (re.test(path)) return READ(method) ? read : write;
  return SUPER;
}

export function allowed(role, method, fullPath) {
  const need = permissionFor(method, fullPath);
  if (role === 'super_admin') return { ok: true, need };
  return { ok: need !== SUPER && can(role, need), need };
}

export default { ROLES, STAFF_ROLES, isStaffRole, can, permissionFor, allowed };
