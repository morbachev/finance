import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const cloud=readFileSync(new URL('../src/cloud/cloud-settings.ts',import.meta.url),'utf8');

test('OneDriveの通常画面は状態・主要操作を表示し設定・テストは折りたたむ',()=>{
  assert.match(html,/<section[^>]*class="panel cloud-panel cloud-overview"/);
  const begin=html.indexOf('<details class="cloud-advanced"');
  assert.ok(begin>0);
  assert.ok(html.indexOf('id="cloud-account"')<begin);
  assert.ok(html.indexOf('id="cloud-live-refresh"')<begin);
  assert.ok(html.indexOf('id="cloud-client-id"')>begin);
  assert.ok(html.indexOf('id="cloud-upload"')>begin);
  assert.match(html,/<details class="cloud-probe-details">/);
  for(const id of ['cloud-status','cloud-folder-check','cloud-live-migrate','cloud-upload','cloud-download','cloud-login','cloud-logout','cloud-account','cloud-live-status']){
    assert.equal((html.match(new RegExp(`id="${id}"`,'g'))??[]).length,1,`${id} should exist once`);
  }
  assert.match(main,/\$\('cloud-live-bar'\)\.classList\.toggle\('hidden', view === 'settings'\)/);
  assert.match(cloud,/if\(!validId\(id\)\) \$<HTMLDetailsElement>\('cloud-advanced'\)\.open=true/);
});
