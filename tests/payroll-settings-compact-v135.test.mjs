import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('public/index.html', root), 'utf8');
const css = await readFile(new URL('public/styles/style.css', root), 'utf8');
const script = await readFile(new URL('src/ui/assets-settings.ts', root), 'utf8');

const settings = html.slice(html.indexOf('id="settings-view"'));

test('Payroll history matches the active Finance UI: accessible history or three-card view', async () => { // finance-ui-validation-v145-fix
  if (settings.includes('class="assets-payroll-history-card"')) {
    // v1.4.5: sync/connect, deposit-account and history are three peer cards.
    assert.match(settings, /<section id="assets-payroll-summary" class="assets-payroll-history-card" aria-label="給与の取得履歴">/);
    assert.match(settings, /<div class="assets-payroll-layout">[\s\S]*?id="assets-payroll-connect"[\s\S]*?id="assets-payroll-deposit-form"[\s\S]*?id="assets-payroll-summary"/);
    assert.doesNotMatch(settings, /<summary>同期の詳細|<summary>取得履歴/);
    assert.match(script, /if\(!payrollSynced\)\{/);
    assert.match(script, /months\.replaceChildren\(\)/);
    assert.doesNotMatch(script, /summary\.open=false/);
    const layout = await readFile(new URL('public/styles/layout-v145.css', root), 'utf8');
    assert.match(layout, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    assert.match(layout, /\.assets-payroll-history-card \.assets-payroll-summary-body\{[\s\S]*?overflow-y:auto/);
  } else {
    // v1.4.4: accordion remains, but was renamed from 同期の詳細 to 取得履歴.
    assert.match(settings, /<details id="assets-payroll-summary" class="assets-payroll-summary hidden">/);
    assert.match(settings, /<summary>取得履歴/);
    assert.doesNotMatch(settings, /<details id="assets-payroll-summary"[^>]*\bopen\b/);
    assert.match(script, /summary\.classList\.toggle\('hidden',!payrollSynced\)/);
    assert.match(script, /if\(!payrollSynced\)\{summary\.open=false;return;\}/);
    assert.match(css, /\.assets-payroll-summary\[open\] \.assets-payroll-chevron/);
  }
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
