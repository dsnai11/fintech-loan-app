import fs from 'fs';
import vm from 'vm';
import { check, section, finish } from '../lib.mjs';

// Every staff portal page keeps its code inside the page. A typo there (for example a stray quote) breaks the whole page
// silently, and nothing else would notice. This reads each page's scripts and makes sure they at least parse.
const dir = new URL('../../../web-portal/', import.meta.url);
const pages = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

section('PORTAL PAGES: THEIR SCRIPTS MUST PARSE');
check('there are portal pages to check', pages.length > 10);
for (const f of pages) {
  const html = fs.readFileSync(new URL(f, dir), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
  let error = null;
  scripts.forEach((code, i) => {
    try { new vm.Script(code, { filename: `${f} script ${i + 1}` }); } catch (e) { error = e; }
  });
  check(`${f} (${scripts.length} script${scripts.length === 1 ? '' : 's'})`, !error, error ? String(error.message) : '');
}
finish();
