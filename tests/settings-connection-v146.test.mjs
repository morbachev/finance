import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('public/index.html', root), 'utf8');
const cloud = await readFile(new URL('src/cloud/cloud-settings.ts', root), 'utf8');
const css = await readFile(new URL('public/styles/layout-v146.css', root), 'utf8');

test('client ID save action is beside its input, above redirect URI', () => {
  const inline = html.match(/<div class="cloud-client-id-inline">([\s\S]*?)<\/div>/)?.[1] ?? '';
  assert.match(inline, /id="cloud-client-id"/);
  assert.match(inline, /id="cloud-save-id"/);
  assert.ok(html.indexOf('id="cloud-client-id"') < html.indexOf('id="cloud-redirect-uri"'));
  assert.match(css, /\.cloud-client-id-inline\{/);
});

test('diagnostics explain their purpose and retain existing controls', () => {
  const section = html.match(/<section class="panel cloud-panel cloud-troubleshooting"[\s\S]*?<\/section>/)?.[0] ?? '';
  for (const id of ['cloud-folder-check','cloud-diagnostic-secret','cloud-vault-diagnose','cloud-diagnostic-copy','cloud-live-migrate']) {
    assert.equal((section.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, id);
  }
  assert.match(section, /ログイン状態や明細は変更しません/);
  assert.match(section, /読み取り専用/);
  assert.match(section, /旧データの移行/);
});

test('folder check does not trigger an automatic login redirect', () => {
  const event = cloud.split("$('cloud-folder-check').addEventListener('click'")[1]?.split("$('cloud-vault-diagnose').addEventListener('click'")[0] ?? '';
  assert.match(event, /graphClientWithoutRedirect\(\)/);
  assert.doesNotMatch(event, /acquireTokenRedirect|loginRedirect/);
  assert.match(event, /15000/);
  assert.match(cloud, /reauthenticationRequired/);
});
