import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recurringSwitchNeedsConfirmation,status} from '../dist/src/ui/assets-settings.js';
const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('a different recurring edit cannot discard the unsaved form without confirmation',()=>{
  assert.equal(recurringSwitchNeedsConfirmation(false,null,'b'),false);
  assert.equal(recurringSwitchNeedsConfirmation(true,null,'b'),true);
  assert.equal(recurringSwitchNeedsConfirmation(true,'a','b'),true);
  assert.equal(recurringSwitchNeedsConfirmation(false,'a','b'),false);
  assert.equal(recurringSwitchNeedsConfirmation(true,'a','a'),false);
  const source=read('src/ui/assets-settings.ts');
  assert.match(source,/actions\.append\(addButton\('編集',\(\)=>\{openRecurringEditor\(item\);\}\)/);
  assert.match(source,/return openRecurringEditor\(match\)/);
  assert.match(source,/if\(recurringSwitchNeedsConfirmation\(recurringHasChanges\(\),editingId,item\.id\)&&!window\.confirm/);
  assert.match(source,/if\(editingId===item\.id\)\{[\s\S]*?return true;/);
  assert.match(source,/\('assets-recurring-clear'\).*window\.confirm\('編集中の入力を破棄してクリアしますか？'\)/);
});

test('asset errors persist at form and disappear on next progress/success, while warnings remain',()=>{
  const original=globalThis.document;
  const attrs=new Map();
  const styles=new Set();
  const node={textContent:'',classList:{toggle(name,enabled){if(enabled)styles.add(name);else styles.delete(name)}},setAttribute(k,v){attrs.set(k,v)},removeAttribute(k){attrs.delete(k)}};
  globalThis.document={getElementById:()=>null};
  try {
    status(node,'保存結果未確認：再取得してください。',true);
    assert.match(node.textContent,/保存結果未確認/);
    assert.equal(attrs.get('role'),'alert');
    assert.equal(styles.has('bad'),true);
    status(node,'保存中…');
    assert.equal(node.textContent,'');
    assert.equal(attrs.has('role'),false);
    status(node,'保存失敗：通信エラー',true);
    assert.match(node.textContent,/保存失敗/);
    status(node,'保存しました。');
    assert.equal(node.textContent,'');
    status(node,'注意：給与らしい定期入金が登録されています。');
    assert.match(node.textContent,/二重計上|注意：/);
  }finally {globalThis.document=original;}
});

test('monthly report load/save errors survive redraw locally and clear only on new attempt',()=>{
  const source=read('src/ui/monthly-reports.ts');
  assert.match(source,/loadFailed\)\{const error=el\('p','reports-feedback-error',message\)/);
  assert.match(source,/if\(message\)\{const error=el\('p','reports-feedback-error',message\)/);
  assert.match(source,/error instanceof CloudWriteUncertainError\?'保存結果未確認':'保存失敗'/);
  assert.match(source,/showActivity\(message,'bad'\)/);
  assert.match(source,/async function fetch\(\).*message='';loadFailed=false/s);
  assert.match(read('public/styles/monthly-reports-v182.css'),/\[data-theme="dark"\] \.reports-feedback-error/);
});

test('card recurring failure stays visible while switching tabs and card label is specific',()=>{
  const source=read('src/ui/subscriptions.ts');
  const html=read('public/index.html');
  assert.match(source,/if\(notice\)\{const error=el\('p','subscriptions-notice error',notice\)/);
  assert.match(source,/\(\)=>\{filter=key;render\(\);\}/);
  assert.match(source,/error instanceof CloudWriteUncertainError\?'保存結果未確認':'保存失敗'/);
  assert.match(html,/data-nav-label="カードの定期支出"/);
  assert.match(html,/<h1>カードの定期支出<span class="accent-dot">/);
  assert.match(read('public/styles/subscriptions-v183.css'),/\[data-theme="dark"\] \.subscriptions-notice\.error/);
});
