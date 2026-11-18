import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('public/index.html');
const assets=read('src/ui/assets-settings.ts');
const summary=read('src/ui/monthly-summary.ts');
const future=read('src/ui/future-projection.ts');
const css=read('public/styles/ui-v153.css');
const main=read('src/main.ts');
test('three account cards share one details panel, not per-card footnotes',()=>{
  assert.match(html,/id="assets-account-info"/);
  assert.match(assets,/accountDetails\.set\(account\.id,detail\)/);
  assert.match(css,/assets-account-grid\{align-items:stretch!important\}/);
  assert.doesNotMatch(assets,/label\.append\(make\('small','assets-balance-hint'/);
});
test('bank card account form is under NISA and outside the monthly summary',()=>{
  assert.ok(html.indexOf('id="assets-nisa-link"')<html.indexOf('id="assets-card-debits"'));
  assert.ok(html.indexOf('id="assets-card-debits"')<html.indexOf('id="assets-recurring-form"'));
  assert.match(assets,/async function saveCardDebitAccounts/);
  assert.match(assets,/await requireVault\(\)\.setCardDebitAccounts\(values\)/);
  assert.doesNotMatch(summary,/monthly-bank-mapping/);
  assert.doesNotMatch(main,/saveCardAccounts:async accounts/);
});
test('bank balance chart uses dated step positions and a baseline-aware first point',()=>{
  assert.match(summary,/function bankChart\(/);
  assert.match(summary,/const firstKnown=timeline\.startDay>=first/);
  assert.match(summary,/path\.push\(`H\$\{x\(day\)/);
  assert.match(summary,/const chart=bankChart\(timeline,period\)/);
  assert.doesNotMatch(summary,/残高は同日の入出金を合算した日末時点の予測です/);
  assert.match(css,/\.monthly-chart\{overflow-x:auto/);
});
test('projection defaults to cash + NISA + combined, scenario is optional',()=>{
  assert.match(html,/id="future-scenario-settings" hidden/);
  assert.match(html,/id="future-scenario-accordion"/);
  assert.match(future,/scenarioAccordion\.addEventListener\('toggle'/);
  assert.match(future,/\['cash','現金貯金','cash'\]/);
  assert.match(future,/\['nisa','NISA','nisa'\]/);
  assert.match(future,/\['combined','現金＋NISA','base'\]/);
  assert.match(future,/if\(compare\)totals\.append/);
});
test('merchant editor and sidebar are purposefully compact',()=>{
  assert.match(css,/\.manage-editor \.manage-merchant-main\{display:grid/);
  assert.match(css,/\.sidebar \.sidebar-subnav,.sidebar\.mobile-open \.sidebar-subnav\{border-left:0!important/);
  assert.doesNotMatch(html,/sidebar-group-chevron/);
});
