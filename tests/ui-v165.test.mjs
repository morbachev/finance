import {styleOrder} from './helpers/css-loading.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FINANCE_VIEWS, VIEW_STORAGE_KEY, readLastView, saveLastView} from '../dist/src/ui/view-preference.js';

const html=readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles/ui-v165.css',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const assets=readFileSync(new URL('../src/ui/assets-settings.ts',import.meta.url),'utf8');
const store=()=>{
  const data=new Map();
  return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
};

test('v1.6.5 last menu is remembered per tab and restored across reloads',()=>{
  assert.deepEqual(FINANCE_VIEWS,['home','import','manage','summary','analysis','subscriptions','reports','rules','assets','future','settings']);
  const storage=store();
  assert.equal(readLastView(storage),null);
  for(const view of FINANCE_VIEWS){
    saveLastView(storage,view);
    assert.equal(readLastView(storage),view);
    assert.equal(storage.data.get(VIEW_STORAGE_KEY),view);
  }
  storage.setItem(VIEW_STORAGE_KEY,'/evil or unknown');
  assert.equal(readLastView(storage),null);
  assert.equal(readLastView(null),null);
  saveLastView(null,'rules');
  assert.equal(readLastView({getItem(){throw Error('denied');}}),null);
  assert.doesNotThrow(()=>saveLastView({setItem(){throw Error('denied');}},'assets'));
});

test('initial route is always Home, and cloud failures do not override it',()=>{
  assert.match(main,/showView\('home'\);/);
  assert.doesNotMatch(main,/showView\(lastView\?\?/);
  assert.doesNotMatch(main,/if \(!readLastView/);
  assert.match(main,/function showView\(view: FinanceView\)[\s\S]*?saveLastView\(sessionStorageSafe\(\), view\);/);
  assert.doesNotMatch(main.split('async function startCloud()')[1].split('async function refreshCloud()')[0],/showView\('settings'\)/);
  assert.match(main,/manage-back-summary[\s\S]*?scrollTop=summaryReturnContentY;[\s\S]*?scrollTo\(0,summaryReturnPageY\)/);
});

test('every cloud-named save button becomes 保存 without changing save handlers',()=>{
  for(const id of ['manage-save','rule-save','categories-dialog-save','assets-once-save','assets-recurring-save']){
    const tag=html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>([^<]*)<\\/button>`));
    assert.ok(tag,`Missing save button ${id}`);
    assert.equal(tag[1],'保存',id);
  }
  assert.doesNotMatch(html,/<button[^>]*>[^<]*OneDrive[^<]*(?:保存|登録)[^<]*<\/button>/);
  assert.doesNotMatch(main,/['"](?:変更を)?OneDriveに(?:ルールを)?保存['"]/);
  assert.doesNotMatch(assets,/textContent='(?:変更を)?OneDrive(?:に|へ)(?:登録|保存)'/);
  assert.match(main,/saveEditedStatement\(s,true\)/);
  assert.match(assets,/await requireVault\(\)\.upsertRecurring\(entry\)/);
});

test('Payroll sync summary has just count and last sync without a scroll history',()=>{
  assert.doesNotMatch(html,/id="assets-payroll-months"/);
  assert.match(html,/id="assets-payroll-count"/);
  assert.match(html,/id="assets-payroll-last"/);
  assert.doesNotMatch(assets,/incomeByMonth\(/);
  assert.doesNotMatch(css,/assets-payroll-months/);
});

test('both one-off transaction radio groups have bordered checked-state options on mobile',()=>{
  assert.match(css,/\.assets-once-dialog \.assets-once-choice > label\s*\{[\s\S]*?border: 1px solid var\(--line\)/);
  assert.match(css,/\.assets-once-dialog \.assets-once-choice > label:has\(input:checked\)/);
  assert.match(css,/@media \(max-width: 630px\)/);
  assert.match(html,/name="assets-once-kind"/);
  assert.match(html,/name="assets-once-status"/);
  assert.match(styleOrder,/styles\/ui-v164\.css[\s\S]*?styles\/ui-v165\.css/);
});
