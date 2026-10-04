import { cpSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Copies the portal pages and shared assets from /web-portal into /backend/public, which the server serves.
const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(here, '..', '..', 'web-portal');
const to = path.resolve(here, '..', 'public');
mkdirSync(to, { recursive: true });
for (const f of readdirSync(from).filter(f => f.endsWith('.html'))) copyFileSync(path.join(from, f), path.join(to, f));
cpSync(path.join(from, 'assets'), path.join(to, 'assets'), { recursive: true });
