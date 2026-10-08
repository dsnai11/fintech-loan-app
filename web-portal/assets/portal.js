// Standard back-office shell: sidebar, top bar, permission-aware menu, sign out and idle timeout.
// A page opts in with <body data-shell="app">. Pages marked data-shell="lite" only get the shared look.
(function () {
  var body = document.body;
  var mode = body.getAttribute('data-shell') || 'lite';
  if (mode === 'lite') { body.classList.add('ent-lite'); return; }

  var IDLE_MINUTES = 20;
  var API = (location.protocol === 'file:' ? 'https://fintech-loan-app-production.up.railway.app' : location.port === '3000' ? 'http://localhost:5000' : location.origin) + '/api';
  var I = {
    loans: '<path d="M3 7h18v12H3z"/><path d="M8 7V5h8v2"/><path d="M3 13h18"/>',
    emi: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2.2.6 3.5 2.4 3.5 5.5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
    staff: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/><path d="M17.5 3.5l1.2 1.2 2.3-2.3"/>',
    scale: '<path d="M12 3v18M5 21h14M5 7h14"/><path d="M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    phoneapp: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    plug: '<path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3"/>',
    board: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8h14v-8M8.5 8C6 8 6 4 9 4c2 0 3 2 3 4 0-2 1-4 3-4 3 0 3 4 .5 4"/>',
    bot: '<rect x="5" y="8" width="14" height="10" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01M3 12v3M21 12v3"/>',
    tick: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    banner: '<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M7 9h6M7 12h4M8 20h8M12 16v4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>'
  };
  // `any` lists the permissions that unlock a page (one is enough). 'super' means the super admin only.
  var NAV = [
    { group: 'Lending' },
    { href: 'loan-management.html', label: 'Loan management', icon: 'loans', any: ['loans.view'] },
    { href: 'emi-analytics.html', label: 'EMI collections', icon: 'emi', any: ['reports.view'] },
    { href: 'decisions.html', label: 'Decisions', icon: 'scale', any: ['decisions.view'] },
    { href: 'customers.html', label: 'Customers', icon: 'users', any: ['customers.view'] },
    { group: 'Customer care' },
    { href: 'support.html', label: 'Messages', icon: 'chat', any: ['support.view', 'announcements.send'] },
    { href: 'callbacks.html', label: 'Call-back requests', icon: 'phone', any: ['support.view'] },
    { href: 'assistant.html', label: 'AI assistant', icon: 'bot', any: ['appsettings.edit'] },
    { href: 'rewards.html', label: 'Rewards', icon: 'gift', any: ['referrals.view'] },
    { href: 'referrals.html', label: 'Referrals', icon: 'gift', any: ['referrals.view'] },
    { group: 'Recovery' },
    { href: 'collections.html', label: 'Collections', icon: 'phone', any: ['collections.view'] },
    { href: 'reminders.html', label: 'Reminders and settlements', icon: 'phone', any: ['collections.view'] },
    { href: 'online-payments.html', label: 'Online payments', icon: 'emi', any: ['collections.view'] },
    { href: 'mandates.html', label: 'Auto-debit', icon: 'emi', any: ['collections.view'] },
    { group: 'Risk and reporting' },
    { href: 'compliance.html', label: 'Compliance', icon: 'shield', any: ['kyc.view', 'aml.view', 'audit.view', 'requests.process'] },
    { href: 'accounting.html', label: 'Accounting', icon: 'chart', any: ['reports.view'] },
    { href: 'regulatory.html', label: 'Regulatory', icon: 'scale', any: ['reports.view'] },
    { href: 'dashboard.html', label: 'Leadership dashboard', icon: 'board', any: ['reports.view'] },
    { href: 'portfolio.html', label: 'Portfolio reports', icon: 'chart', any: ['reports.view'] },
    { href: 'analytics.html', label: 'Analytics', icon: 'chart', any: ['reports.view'] },
    { group: 'Administration' },
    { href: 'pricing.html', label: 'Pricing and controls', icon: 'tag', any: ['pricing.view'] },
    { href: 'charges.html', label: 'Charges', icon: 'tag', any: ['pricing.view'] },
    { href: 'app-settings.html', label: 'Customer app', icon: 'phoneapp', any: ['appsettings.edit'] },
    { href: 'approvals.html', label: 'Approvals', icon: 'tick', any: ['changes.approve', 'pricing.edit', 'banners.edit'] },
    { href: 'nudges.html', label: 'Nudges', icon: 'chat', any: ['banners.edit'] },
    { href: 'offers.html', label: 'Offers tab', icon: 'tag', any: ['banners.edit'] },
    { href: 'app-banners.html', label: 'Offers and branding', icon: 'banner', any: ['banners.edit'] },
    { href: 'integrations.html', label: 'Integrations', icon: 'plug', any: ['config.manage'] },
    { href: 'staff.html', label: 'Staff', icon: 'staff', any: ['staff.manage'] },
    { href: 'roles.html', label: 'Roles and permissions', icon: 'key', any: ['super'] },
    { href: 'admin-config.html', label: 'Configuration', icon: 'gear', any: ['config.manage'] }
  ];
  var ROLE_FALLBACK = { super_admin: 'Super admin' };

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  function perms() { try { return JSON.parse(store('admin_perms') || '[]'); } catch (e) { return []; } }
  function role() { return store('admin_role') || 'super_admin'; }
  function has(list) {
    if (role() === 'super_admin') return true;
    var mine = perms();
    if (mine.indexOf('*') >= 0) return true;
    return list.some(function (p) { return p !== 'super' && mine.indexOf(p) >= 0; });
  }
  function landing(p) {
    var mine = p || perms();
    if (mine.indexOf('*') >= 0) return 'admin-config.html';
    for (var i = 0; i < NAV.length; i++) {
      var n = NAV[i];
      if (n.href && n.any.indexOf('super') < 0 && n.href !== 'admin-config.html' && n.any.some(function (x) { return mine.indexOf(x) >= 0; })) return n.href;
    }
    return 'compliance.html'; // everyone can reach "My security" there
  }

  function signOut() {
    try { ['admin_token', 'admin_user', 'admin_role', 'admin_perms', 'admin_role_label'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
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
  if (oldHeader && !old) oldHeader.style.display = 'none';
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
    var html = '<div class="ent-brand"><b>Laxmi India Finance</b><span>Back office</span></div><nav class="ent-nav">';
    var pending = null; var shown = 0;
    NAV.forEach(function (n) {
      if (n.group) { pending = n.group; return; }
      var ok = n.any.indexOf('super') >= 0 ? role() === 'super_admin' : has(n.any);
      if (!ok) return;
      if (pending) { html += '<div class="grp">' + esc(pending) + '</div>'; pending = null; }
      html += '<a href="' + n.href + '"' + (n.href === here ? ' class="on" aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + I[n.icon] + '</svg>' + esc(n.label) + '</a>';
      shown++;
    });
    // Everyone can reach their own security settings (two-factor sign-in).
    if (!has(['kyc.view', 'aml.view', 'audit.view', 'requests.process'])) {
      html += '<div class="grp">Account</div><a href="compliance.html"' + ('compliance.html' === here ? ' class="on"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + I.shield + '</svg>My security</a>';
    }
    side.innerHTML = html + '</nav>';

    top.innerHTML = '<button class="ent-burger" aria-label="Open menu" id="ent-burger">&#9776;</button>' +
      '<div class="ent-title"><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div><div class="ent-actions" id="ent-actions"></div>' +
      '<div class="ent-user"><div class="who"><b>' + esc(store('admin_user') || '') + '</b><span class="ent-role">' + esc(store('admin_role_label') || ROLE_FALLBACK[role()] || role().replace(/_/g, ' ')) + '</span></div>' +
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

  // Pages a person's role cannot use send them to the first one it can.
  if (here === 'admin-config.html' && signedIn() && role() !== 'super_admin' && !has(['config.manage'])) location.replace(landing());

  // Ask the server who I am now, so a change to my role shows up without signing in again.
  if (signedIn()) {
    fetch(API + '/admin/me', { headers: { Authorization: 'Bearer ' + store('admin_token') } }).then(function (r) {
      if (r.status === 401) { signOut(); return null; }
      return r.ok ? r.json() : null;
    }).then(function (me) {
      if (!me) return;
      store('admin_role', me.role); store('admin_perms', JSON.stringify(me.permissions || [])); store('admin_role_label', me.roleLabel || '');
      build();
    }).catch(function () {});
  }

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

  window.PortalShell = { refresh: build, landing: landing, can: function (perm) { return has([perm]); } };
})();
