import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync('dist/index.html','utf8');
const js=readFileSync('dist/src/main.js','utf8');
const css=readFileSync('dist/styles/style.css','utf8');
test('status of cloud saves/deletions remains in a visible live region',()=>{
  assert.match(html,/id="operation-result"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(js,/operationResult\(mutationWarning\s*\?\?\s*'変更内容をOneDriveに保存しました。'/);
  assert.match(js,/operationResult\(mutationWarning\s*\?\?\s*result/);
  assert.match(js,/operationResult\(.*'working'/s);
  assert.match(css,/\.operation-result\.hidden\s*\{display:none\}/);
});
test('the tab-session checkbox is optional, off by default, and hidden during IndexedDB migration',()=>{
  assert.match(html,/id="vault-tab-keep" type="checkbox"/);
  assert.doesNotMatch(html,/id="vault-tab-keep"[^>]*checked/);
  assert.match(js,/mode\s*===\s*'migrate'/);
  assert.match(js,/clearRememberedKey\(\)/);
  assert.match(js,/unlockTab/);
});
