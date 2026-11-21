import {styleOrder} from './helpers/css-loading.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
const css = readFileSync(new URL('../public/styles/ui-v168.css', import.meta.url),'utf8');

test('v1.6.8 shares the same desktop content gutters between import and management',()=>{
  assert.match(styleOrder,/styles\/ui-v167\.css[\s\S]*?styles\/ui-v168\.css/);
  assert.match(css,/\.content:has\(#import-view:not\(\.hidden\)\)/);
  assert.match(css,/\.content:has\(#manage-view:not\(\.hidden\)\)/);
  assert.match(css,/padding-left: clamp\(18px, 2vw, 32px\)/);
  assert.match(css,/padding-right: clamp\(18px, 2vw, 32px\)/);
});

test('v1.6.8 shares grid columns and gap, without touching scrolling',()=>{
  assert.match(css,/#import-view > \.results-grid,\s*#manage-view > \.manage-grid\s*\{[\s\S]*?grid-template-columns: minmax\(315px, 2\.4fr\) minmax\(0, 5fr\)/);
  assert.match(css,/gap: 18px/);
  assert.doesNotMatch(css,/overflow(?:-x|-y)?\s*:/);
  assert.doesNotMatch(css,/max-height:|min-height:|position: sticky/);
});

test('v1.6.8 leaves mobile rules unchanged',()=>{
  assert.match(css,/@media \(min-width: 981px\)/);
  assert.doesNotMatch(css,/@media \(max-width:/);
  const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.ok(html.includes(`Finance v${version}`));
});
