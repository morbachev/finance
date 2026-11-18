import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles/ui-v164.css',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');

test('v1.6.4 desktop-only rules loaded after v1.6.3',()=>{
  assert.match(html,/styles\/ui-v163\.css[\s\S]*styles\/ui-v164\.css/);
  assert.match(css,/@media \(min-width: 981px\)/);
  assert.doesNotMatch(css,/@media \(max-width:/);
});
test('transaction headers compact and date editor width capped',()=>{
  assert.match(css,/transaction-table thead th[\s\S]*padding-top: 7px/);
  assert.match(css,/col-date \{width: 140px !important;/);
  assert.match(css,/max-width: 126px/);
});
test('desktop PDF dropzone has breathing room and no redundant file-count caption',()=>{
  assert.doesNotMatch(html,/複数ファイル対応/);
  assert.match(css,/height: 116px !important/);
  assert.match(css,/height: 99px !important/);
});
test('view switching resets page and content scroll; explicit return restores position',()=>{
  assert.match(main,/function showView\([\s\S]*?if \(content\) content\.scrollTop = 0;\s*window\.scrollTo\(0, 0\);/);
  assert.match(main,/manage-back-summary[\s\S]*?scrollTop=summaryReturnContentY;[\s\S]*?scrollTo\(0,summaryReturnPageY\)/);
});
