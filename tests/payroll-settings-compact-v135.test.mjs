import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('public/index.html', root), 'utf8');
const css = await readFile(new URL('public/styles/style.css', root), 'utf8');
const script = await readFile(new URL('src/ui/assets-settings.ts', root), 'utf8');

const settings = html.slice(html.indexOf('id="settings-view"'));

test('Payroll successful synchronization details use a closed native accordion', () => {
  assert.match(settings, /<details id="assets-payroll-summary" class="assets-payroll-summary hidden">/);
  assert.match(settings, /<summary>同期の詳細/);
  assert.doesNotMatch(settings, /<details id="assets-payroll-summary"[^>]*\bopen\b/);
  assert.match(script, /summary\.classList\.toggle\('hidden',!payrollSynced\)/);
  assert.match(script, /if\(!payrollSynced\)\{summary\.open=false;return;\}/);
  assert.match(css, /\.assets-payroll-summary\[open\] \.assets-payroll-chevron/);
});

test('Settings exposes only sync diagnostics rather than salary amounts', () => {
  const payrollSection = settings.slice(0, settings.indexOf('id="cloud-view"'));
  assert.doesNotMatch(payrollSection, /総手取り|月別の給与実績|assets-payroll-net|amounts\.netPay/);
  assert.match(payrollSection, /id="assets-payroll-count"/);
  assert.match(payrollSection, /id="assets-payroll-last"/);
  assert.match(script, /make\('small','',`\$\{amounts\.count\}件`\)/);
  assert.doesNotMatch(script, /\$\('assets-payroll-net'\)|yen\(amounts\.netPay\)/);
  assert.match(script, /renderAccounts\(\);renderPayroll\(\)/); // account forecasting still refreshed
});

test('Password-change help text no longer claims a connection is required before an action', () => {
  assert.match(settings, /<p id="cloud-rotate-status" class="cloud-status" role="status" aria-live="polite"><\/p>/);
  assert.doesNotMatch(settings, /変更にはMicrosoftアカウントへの接続と保管庫のロック解除が必要です。/);
  assert.match(css, /\.cloud-rotate-panel #cloud-rotate-status:empty\{display:none\}/);
});
