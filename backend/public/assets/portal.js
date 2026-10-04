// Standard back-office shell: sidebar, top bar, role-aware menu, sign out and idle timeout.
// A page opts in with <body data-shell="app">. Pages marked data-shell="lite" only get the shared look.
(function () {
  var body = document.body;
  var mode = body.getAttribute('data-shell') || 'lite';
  if (mode === 'lite') { body.classList.add('ent-lite'); return; }

  var IDLE_MINUTES = 20;
  var ROLE_LABEL = {
    super_admin: 'Super admin', credit_officer: 'Credit officer', kyc_reviewer: 'KYC reviewer', collections_agent: 'Collections agent',
    collections_manager: 'Collections manager', finance: 'Finance', compliance_officer: 'Compliance officer', auditor: 'Auditor'
  };
  var LANDING = {
    credit_officer: 'loan-management.html', finance: 'loan-management.html', kyc_reviewer: 'compliance.html', compliance_officer: 'compliance.html',
    auditor: 'compliance.html', collections_agent: 'collections.html', collections_manager: 'collections.html'
  };
  var ALL = ['super_admin', 'credit_officer', 'kyc_reviewer', 'collections_agent', 'collections_manager', 'finance', 'compliance_officer', 'auditor'];
  var REPORTS = ['super_admin', 'credit_officer', 'collections_manager', 'finance', 'compliance_officer', 'auditor'];
  var I = {
    loans: '<path d="M3 7h18v12H3z"/><path d="M8 7V5h8v2"/><path d="M3 13h18"/>',
    emi: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2.2.6 3.5 2.4 3.5 5.5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
    staff: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/><path d="M17.5 3.5l1.2 1.2 2.3-2.3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>'
  };
  var NAV = [
    { group: 'Lending' },
    { href: 'loan-management.html', label: 'Loan management', icon: 'loans', roles: ['super_admin', 'credit_officer', 'finance', 'auditor'] },
    { href: 'emi-analytics.html', label: 'EMI collections', icon: 'emi', roles: REPORTS },
    { href: 'customers.html', label: 'Customers', icon: 'users', roles: ALL },
    { group: 'Recovery' },
    { href: 'collections.html', label: 'Collections', icon: 'phone', roles: ['super_admin', 'collections_agent', 'collections_manager', 'auditor'] },
    { group: 'Risk and reporting' },
    { href: 'compliance.html', label: 'Compliance', icon: 'shield', roles: ['super_admin', 'kyc_reviewer', 'compliance_officer', 'auditor'] },
    { href: 'analytics.html', label: 'Analytics', icon: 'chart', roles: REPORTS },
    { group: 'Administration' },
    { href: 'pricing.html', label: 'Pricing and controls', icon: 'tag', roles: ['super_admin', 'credit_officer', 'finance', 'auditor'] },
    { href: 'staff.html', label: 'Staff', icon: 'staff', roles: ['super_admin'] },
    { href: 'admin-config.html', label: 'Configuration', icon: 'gear', roles: ['super_admin'] }
  ];

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  function signOut() {
    try { ['admin_token', 'admin_user', 'admin_role'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    location.href = 'admin-config.html';
  }

  function signedIn() { return !!store('admin_token'); }

  // Pull the page's own title (and any real action buttons) out of its old header before the shell replaces it.
  var title = body.getAttribute('data-title') || '';
  var sub = body.getAttribute('data-sub') || '';
  var actions = [];
  var old = document.querySelector('.container > .header, body > .header, .header');
  if (old) {
    var h1 = old.querySelector('h1'); var p = old.querySelector('p');
    if (h1 && !title) title = h1.textContent.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (p && !sub) sub = p.textContent.trim();
    old.querySelectorAll('button').forEach(function (b) {
      var oc = (b.getAttribute('onclick') || '');
      var label = b.textContent;
      if (b.closest('a') || b.classList.contains('logout-btn') || /logout|location/i.test(oc)) return;
      if (/analytics|collections|compliance|pricing|back|staff|customers/i.test(label)) return;
      if (oc) actions.push(b);
    });
    old.style.display = 'none';
  }
  var oldHeader = document.querySelector('body > header, header');
  if (oldHeader && !old) {
    if (!title) title = body.getAttribute('data-title') || document.title.replace(/\s*[-|].*$/, '');
    oldHeader.style.display = 'none';
  }
  if (!title) title = document.title.replace(/\s*[-|].*$/, '');

  var app = document.createElement('div');
  app.className = 'ent-app';
  var side = document.createElement('aside');
  side.className = 'ent-side';
  side.setAttribute('aria-label', 'Main menu');
  var main = document.createElement('div');
  main.className = 'ent-main';
  var top = document.createElement('div');
  top.className = 'ent-top';
  var content = document.createElement('main');
  content.className = 'ent-content';
  content.id = 'ent-content';

  function build() {
    var role = store('admin_role') || 'super_admin';
    var html = '<div class="ent-brand"><b>Laxmi India Finance</b><span>Back office</span></div><nav class="ent-nav">';
    var pending = null;
    NAV.forEach(function (n) {
      if (n.group) { pending = n.group; return; }
      if (n.roles.indexOf(role) < 0) return;
      if (pending) { html += '<div class="grp">' + esc(pending) + '</div>'; pending = null; }
      html += '<a href="' + n.href + '"' + (n.href === here ? ' class="on" aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + I[n.icon] + '</svg>' + esc(n.label) + '</a>';
    });
    side.innerHTML = html + '</nav>';

    top.innerHTML = '<button class="ent-burger" aria-label="Open menu" id="ent-burger">&#9776;</button>' +
      '<div class="ent-title"><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div><div class="ent-actions" id="ent-actions"></div>' +
      '<div class="ent-user"><div class="who"><b>' + esc(store('admin_user') || '') + '</b><span class="ent-role">' + esc(ROLE_LABEL[role] || role) + '</span></div>' +
      '<button class="btn" id="ent-signout" type="button">Sign out</button></div>';
    var box = top.querySelector('#ent-actions');
    actions.forEach(function (b) { b.classList.add('btn'); box.appendChild(b); });
    top.querySelector('#ent-signout').onclick = signOut;
    top.querySelector('#ent-burger').onclick = function () { body.classList.toggle('ent-open'); };
    body.classList.toggle('ent-bare', !signedIn());
  }

  // Move everything the page already has into the content area.
  var kids = Array.prototype.slice.call(body.childNodes).filter(function (n) {
    return !(n.nodeType === 1 && /^(SCRIPT|STYLE|LINK)$/.test(n.tagName));
  });
  kids.forEach(function (n) { content.appendChild(n); });
  main.appendChild(top);
  main.appendChild(content);
  app.appendChild(side);
  app.appendChild(main);
  body.insertBefore(app, body.firstChild);
  body.classList.add('ent');
  build();

  content.addEventListener('click', function () { body.classList.remove('ent-open'); });

  // Staff who are not super admin never need the configuration page.
  var role0 = store('admin_role');
  if (here === 'admin-config.html' && signedIn() && role0 && role0 !== 'super_admin') location.replace(LANDING[role0] || 'customers.html');

  // Idle timeout: sign out after IDLE_MINUTES without activity.
  var last = Date.now();
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(function (e) { document.addEventListener(e, function () { last = Date.now(); }, { passive: true }); });
  setInterval(function () {
    if (!signedIn()) return;
    if (Date.now() - last > IDLE_MINUTES * 60000) {
      var t = document.createElement('div'); t.className = 'ent-toast'; t.textContent = 'Signed out after ' + IDLE_MINUTES + ' minutes of inactivity.';
      document.body.appendChild(t);
      setTimeout(signOut, 1200);
    }
  }, 30000);

  window.PortalShell = { refresh: build };
})();
