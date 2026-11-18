import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const ONEDRIVE_DOWNLOAD_ORIGIN = 'https://my.microsoftpersonalcontent.com';

async function cspIn(file) {
  const html = await readFile(new URL(file, import.meta.url), 'utf8');
  const meta = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(meta, `${file} needs a CSP meta tag`);
  const rules = Object.fromEntries(meta[1].split(';').map(s=>s.trim()).filter(Boolean).map(s=>{
    const [key,...sources] = s.split(/\s+/);return [key,sources];
  }));
  return rules;
}

for (const file of ['../public/index.html','../dist/index.html']) {
  test(`OneDrive signed content downloads are permitted in ${file}`,async()=>{
    const rules = await cspIn(file);
    assert.ok(rules['connect-src']?.includes(ONEDRIVE_DOWNLOAD_ORIGIN),
      'Allow the OneDrive signed content host observed in browser diagnostics');
    assert.ok(rules['connect-src'].includes('https://graph.microsoft.com'));
    assert.ok(rules['connect-src'].includes('https://login.microsoftonline.com'));
    assert.ok(!rules['connect-src'].includes('*'), 'Do not weaken connect-src to an unrestricted wildcard');
    assert.ok(rules['script-src']?.includes("'self'"));
    assert.ok(rules['object-src']?.includes("'none'"));
  });
}
