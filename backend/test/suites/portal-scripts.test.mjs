import fs from 'fs';
import vm from 'vm';
import { check, section, finish } from '../lib.mjs';

// Every staff portal page keeps its code inside the page. A typo there (for example a stray quote) breaks the whole page
// silently, and nothing else would notice. This reads each page's scripts and makes sure they at least parse.
const root = new URL('../../../web-portal/', import.meta.url);
const read = (dir, f) => fs.readFileSync(new URL(dir + f, root), 'utf8');
const pagesIn = dir => fs.readdirSync(new URL(dir, root)).filter(f => f.endsWith('.html'));
const scriptsOf = html => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());

section('PORTAL PAGES: THEIR SCRIPTS MUST PARSE');
const admin = pagesIn(''), lms = pagesIn('lms/');
check('there are admin console pages to check', admin.length > 10);
check('there are LMS pages to check', lms.length >= 9);
for (const [dir, list] of [['', admin], ['lms/', lms]]) {
  for (const f of list) {
    const scripts = scriptsOf(read(dir, f));
    let error = null;
    scripts.forEach((code, i) => { try { new vm.Script(code, { filename: `${dir}${f} script ${i + 1}` }); } catch (e) { error = e; } });
    check(`${dir}${f} (${scripts.length} script${scripts.length === 1 ? '' : 's'})`, !error, error ? String(error.message) : '');
  }
}
try { new vm.Script(read('assets/', 'portal.js'), { filename: 'assets/portal.js' }); check('the shared menu and shell script parses', true); } catch (e) { check('the shared menu and shell script parses', false, e.message); }

section('THE LMS IS ITS OWN CONSOLE');
const need = ['index.html', 'home.html', 'loans.html', 'collections.html', 'reminders.html', 'autodebit.html', 'payments.html', 'emi.html', 'reports.html', 'reconcile.html'];
check('every LMS page is there', need.every(f => lms.includes(f)), need.filter(f => !lms.includes(f)).join(', '));
for (const f of lms) {
  const html = read('lms/', f);
  check(`lms/${f} uses its own session, not the admin console's`, !/admin_token|admin_user|admin_role|admin_perms/.test(html));
  check(`lms/${f} loads the shared files from one folder up`, !/(href|src)="assets\//.test(html) && (f === 'index.html' || /\.\.\/assets\/portal\.js/.test(html)));
  if (f !== 'index.html') check(`lms/${f} sends a signed-out visitor to the LMS sign-in, not the admin one`, /location\.href\s*=\s*'index\.html'/.test(html) && !/admin-config\.html/.test(html.replace(/<a href="admin-config\.html">[^<]*<\/a>/g, '')));
  check(`lms/${f} says it belongs to the LMS`, /data-portal="lms"/.test(html));
}
const moved = { 'collections.html': 'lms/collections.html', 'reminders.html': 'lms/reminders.html', 'online-payments.html': 'lms/payments.html', 'mandates.html': 'lms/autodebit.html', 'emi-analytics.html': 'lms/emi.html', 'lms.html': 'lms/loans.html' };
for (const [old, now] of Object.entries(moved)) {
  const html = read('', old);
  check(`the old address ${old} sends people to ${now}`, html.includes(`url=${now}`) && html.includes(`location.replace('${now}')`) && html.length < 900);
}
const shell = read('assets/', 'portal.js');
const adminNav = shell.slice(shell.indexOf('var NAV = ['), shell.indexOf('var ROLE_FALLBACK'));
check('the admin console menu no longer lists the pages that moved', !/href: '(collections|reminders|online-payments|mandates|emi-analytics|lms)\.html'/.test(adminNav));
check('the admin console menu has a way into the LMS', adminNav.includes("href: 'lms/home.html'"));
check('the LMS menu has its own pages and a way back to the admin console', /var LMS_ANY/.test(shell) && shell.includes("href: 'loans.html'") && shell.includes("href: '../admin-config.html'"));
check('the shell keeps the two sessions apart', shell.includes("var K = PORTAL === 'lms' ? 'lms_' : 'admin_'") && !/store\('admin_/.test(shell));
finish();
