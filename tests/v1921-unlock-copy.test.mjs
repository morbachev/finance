import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync('public/index.html','utf8');
const main=readFileSync('src/main.ts','utf8');
const distHtml=readFileSync('dist/index.html','utf8');
const distMain=readFileSync('dist/src/main.js','utf8');

test('unlock dialog has no redundant OneDrive download explanation or empty gap',()=>{
  assert.match(html,/<p id="vault-dialog-copy" class="hidden"><\/p>/);
  assert.doesNotMatch(main,/OneDriveの暗号化明細を取得しました。1Passwordから専用パスフレーズを入力してください。/);
  assert.match(main, /: '';/);
  assert.match(main,/\$\('vault-dialog-copy'\)\.classList\.toggle\('hidden',!unlockDescription\)/);
});

test('new vault and legacy migration still display their relevant descriptions',()=>{
  assert.match(main,/mode==='create'/);
  assert.match(main,/OneDriveに暗号化保管庫を作成します/);
  assert.match(main,/旧ブラウザ保存に使ったパスフレーズを入力します/);
  assert.match(main,/旧v1\.0の保管庫が見つかりました/);
  assert.match(distHtml,/<p id="vault-dialog-copy" class="hidden"><\/p>/);
  assert.match(distMain,/classList\.toggle\('hidden',\s*!unlockDescription\)/);
  assert.doesNotMatch(distMain,/OneDriveの暗号化明細を取得しました。1Passwordから専用パスフレーズを入力してください。/);
});
