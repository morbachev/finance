import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../'+file, import.meta.url),'utf8');
const html=read('public/index.html');
const css=read('public/styles/ui-v159.css');
const future=read('src/ui/future-projection.ts');
const assetUi=read('src/ui/assets-settings.ts');

test('forecast comparison offers independent cash/NISA checkboxes with optional simultaneous changes',()=>{
  assert.match(html, /id="future-compare-cash" type="checkbox" checked/);
  assert.match(html, /id="future-compare-nisa" type="checkbox"/);
  assert.doesNotMatch(html, /name="future-compare-type"/);
  assert.doesNotMatch(html, /<legend>変更する積立<\/legend>/);
  assert.match(future,/const changesCash=compare&&cashChoice\.checked/);
  assert.match(future,/const changesNisa=compare&&nisaChoice\.checked/);
  assert.match(future,/if\(!cashChoice\.checked&&!nisaChoice\.checked\)choice\.checked=true/);
  assert.match(future,/cashScenarioMonthly:changesCash\?amount:null/);
  assert.match(future,/nisaScenarioMonthly:changesNisa\?scenarioNisaAmount:null/);
});
test('one disclosure has no doubled arrow and NISA amount sits above return range',()=>{
  const amount=html.indexOf('id="future-nisa-monthly"'),rate=html.indexOf('id="future-nisa-rate"');
  assert.ok(amount>0&&rate>amount);
  assert.match(css,/#future-scenario-accordion>summary::after/);
  assert.match(css,/content:""!important/);
  assert.match(css,/transform:none!important/);
});
test('bank linking shows both forms in one two-column disclosure while retaining distinct save actions',()=>{
  const start=html.indexOf('<details class="assets-links-panel panel" id="assets-card-links">');
  const end=html.indexOf('</details>',start);
  const section=html.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(section,/id="assets-nisa-link-form"/);
  assert.match(section,/id="assets-card-debits-form"/);
  assert.match(section,/id="assets-nisa-save"/);
  assert.match(section,/引落口座を保存/);
  assert.equal((section.match(/<summary>/g)||[]).length,1);
  assert.match(css,/\.assets-links-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.assets-links-panel:not\(\[open\]\)>\.assets-links-grid\{display:none!important\}/);
});
test('Mizuho prediction closed in details yet its form and controls remain available',()=>{
  assert.match(html, /<details class="panel mizuho-plan-panel" id="mizuho-plan-panel">/);
  assert.match(html, /<summary id="mizuho-plan-title">みずほ銀行への送金予測<\/summary>/);
  assert.match(html, /id="mizuho-plan-form"/);
  assert.match(css,/#mizuho-plan-panel:not\(\[open\]\)>form\{display:none!important\}/);
});
test('recurring form shows amount, source bank and category in same responsive row',()=>{
  const section=html.slice(html.indexOf('<div class="recurring-account-row">'),html.indexOf('<div class="recurring-schedule-row">'));
  assert.ok(section.includes('id="assets-recurring-amount"'));
  assert.ok(section.includes('id="assets-recurring-from"'));
  assert.ok(section.includes('id="assets-recurring-category"'));
  assert.match(css,/\.recurring-account-row\{display:grid!important;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
test('one-time modal always discards draft on close and freezes background scroll',()=>{
  assert.doesNotMatch(assetUi, /入力途中の変更を破棄しますか/);
  assert.match(assetUi, /onceDialog\.addEventListener\('close',unlockOncePage\)/);
  assert.match(assetUi, /onceDialog\.showModal\(\);\s*lockOncePage\(\)/);
  assert.match(assetUi, /function closeOnce\(\):void \{if\(busy\)return;onceDialog\.close\(\);resetOnceForm\(\);\}/);
  assert.match(css, /html\.assets-once-page-locked,html\.assets-once-page-locked body\{overflow:hidden!important/);
  assert.match(css, /#categories-dialog-close,#recent-merchants-close/);
});
