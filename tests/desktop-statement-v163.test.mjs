import {styleOrder} from './helpers/css-loading.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css = readFileSync(new URL('../public/styles/ui-v163.css',import.meta.url),'utf8');

test('v1.6.3 loads a dedicated desktop-only stylesheet after earlier styles', () => {
  assert.match(styleOrder, /styles\/ui-v162\.css[\s\S]*?styles\/ui-v163\.css/);
  assert.match(css, /@media \(min-width: 981px\)/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*(?:700|800)px\)/);
});
test('import screen fills viewport and scrolls only the pending list / transaction rows', () => {
  assert.match(css, /#import-view:not\(\.hidden\)/);
  assert.match(css, /#import-view\s*>\s*\.results-grid\s*\{[^}]*flex:1 1 0/s);
  assert.match(css, /#import-view\s+\.statement-index-panel\s*>\s*\.statement-list\s*\{[^}]*overflow-y:auto/s);
  assert.match(css, /#import-view\s+\.transactions-panel-inner\s*>\s*\.table-scroll\s*\{[^}]*overflow-y:auto/s);
  assert.match(css, /#import-view\s*>\s*\.batch-bar\s*\{[^}]*flex:0 0 auto/s);
  assert.match(css, /#import-view\s*>\s*\.batch-bar\s*\{order:3/);
});
test('manage screen fixes statement fields and footer while transaction body scrolls', () => {
  assert.match(css, /#manage-view\s*>\s*\.manage-grid\s*\{[^}]*flex:1 1 0/s);
  assert.match(css, /#manage-view\s+\.manage-index\s*>\s*\.statement-list\s*\{[^}]*overflow-y:auto/s);
  assert.match(css, /#manage-view\s+#manage-content\s*>\s*\.table-scroll\s*\{[^}]*overflow-y:auto/s);
  assert.match(css, /#manage-view\s+#manage-content\s*>\s*\.manage-foot\s*\{flex:0 0 auto/);
  assert.match(css, /#manage-view\s+\.transaction-table\s+thead th\s*\{[^}]*position:sticky/s);
});
test('existing mobile list/ledger has no viewport-height overrides', () => {
  assert.match(html, /id="manage-list"/);
  assert.match(html, /id="manage-save"/);
  assert.match(html, /id="batch-import"/);
  assert.match(css, /@media \(min-width:981px\) and \(max-height:680px\)/);
});
