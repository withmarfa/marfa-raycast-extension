#!/usr/bin/env node
// npm ls only compares the installed tree against package.json's declared
// range, so a minor bump that stays inside that range (e.g. within
// `^6.0.0`) passes even when node_modules was never reinstalled. Compare
// against what package-lock.json actually resolved instead, which is the
// only place the intended version is recorded exactly.
const fs = require('fs');
const path = require('path');

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
let failed = false;
for (const [key, { version }] of Object.entries(lock.packages ?? {})) {
  if (!key.startsWith('node_modules/@withmarfa/') || !version) continue;
  let installed;
  try {
    installed = JSON.parse(fs.readFileSync(path.join(key, 'package.json'), 'utf8')).version;
  } catch {
    installed = null;
  }
  if (installed !== version) {
    console.error(
      `${key.slice('node_modules/'.length)}: installed ${installed ?? '(missing)'}, lockfile resolves ${version}. Reinstall: npm ci`,
    );
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
