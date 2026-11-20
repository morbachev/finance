import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

test('import preview shows totals without redundant file-format caption', () => {
  assert.match(html, /class="amount-summary" role="group" aria-label="請求総額"/);
  assert.match(html, /id="amount-stated"/);
  assert.match(html, /id="amount-calculated"/);
  assert.match(html, /id="amount-diff"/);
  assert.doesNotMatch(html, /CSV \/ PDF \/ Web明細の請求総額/);
});

test('import preview has no permanent instructional footer or source metadata line', () => {
  assert.doesNotMatch(html, /取引の編集は左ナビ/);
  assert.doesNotMatch(html, /PDF原本は暗号化して保存します/);
  assert.doesNotMatch(html, /CSV・テキスト明細は解析済みデータだけを保存します/);
  assert.doesNotMatch(html, /id="source-meta"/);
  assert.doesNotMatch(main, /\$\('source-meta'\)/);
  assert.match(main, /\$\('amount-stated'\)\.textContent = yen\(s\.statedTotal\)/);
});
