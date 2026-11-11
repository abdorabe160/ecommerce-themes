#!/usr/bin/env node
/**
 * Cache-busting: Qumra's CDN serves theme assets as immutable for a year, so the layout appends
 * `?v={{ assetv }}`. This rewrites assetv to a short hash of the CSS + JS. Run after `npm run build:css`.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const hash = crypto.createHash('sha1');
for (const f of ['assets/decafe.css', 'assets/main.js']) hash.update(fs.readFileSync(path.join(root, f)));
const v = hash.digest('hex').slice(0, 8);

const layout = path.join(root, 'layouts/layout.njk');
const src = fs.readFileSync(layout, 'utf8');
const out = src.replace(/(\{%-?\s*set assetv = ')[^']*('\s*-?%\})/, `$1${v}$2`);
if (out === src && !src.includes(`'${v}'`)) { console.error('assetv marker not found in layouts/layout.njk'); process.exit(1); }
fs.writeFileSync(layout, out);
console.log('assetv =', v);
