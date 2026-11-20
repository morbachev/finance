import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ignoreFile = new URL('../.gitleaksignore', import.meta.url);
const auditFile = new URL('../scripts/audit-publication.mjs', import.meta.url);
const expected = [
  '667644e138623d9606c25f7d559d9476e38459a5:tests/write-outcome-v1612.test.mjs:generic-api-key:8',
  'fdb7f28954406964f35ec11c89169098e7d9f36b:dist/vendor/msal/msal-browser.bundle.js:generic-api-key:1',
];

test('historical Gitleaks ignore is limited to two exact fingerprints', () => {
  const text = readFileSync(ignoreFile, 'utf8');
  const entries = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  assert.deepEqual(entries, expected);
  assert.ok(entries.every(s => /^[a-f0-9]{40}:[^:]+:generic-api-key:\d+$/.test(s)));
});

test('publication audit validates the exact Gitleaks ignore file', () => {
  const text = readFileSync(auditFile, 'utf8');
  assert.match(text, /path==='\.gitleaksignore'/);
  assert.match(text, /承認済みの2件以外を除外/);
  assert.match(text, /expected\.has\(line\)/);
});
