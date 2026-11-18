import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('public/index.html', root), 'utf8');
const main = readFileSync(new URL('src/main.ts', root), 'utf8');
const css = readFileSync(new URL('public/styles/ui-v154.css', root), 'utf8');
const primary = html.match(/<input id="rule-pattern"[^>]*>/)?.[0];

test('primary merchant pattern input ignores browser and 1Password autofill', () => {
  assert.ok(primary);
  assert.match(primary, /autocomplete="off"/);
  assert.match(primary, /data-1p-ignore="true"/);
  assert.match(primary, /spellcheck="false"/);
});

test('added merchant pattern inputs are opt-out before insertion into DOM', () => {
  const from = main.indexOf('function renderRulePatternAlternatives(');
  const to = main.indexOf('function addRulePatternAlternative(', from);
  assert.ok(from > 0 && to > from);
  const fn = main.slice(from,to);
  assert.match(fn, /input\.autocomplete='off'/);
  assert.match(fn, /input\.setAttribute\('data-1p-ignore','true'\)/);
  assert.ok(fn.indexOf("setAttribute('data-1p-ignore'") < fn.indexOf('container.append(row)'));
});

test('category add is neutral while OneDrive save retains primary styling', () => {
  assert.match(html, /id="rules-category-add" class="secondary-action"/);
  assert.match(html, /id="categories-dialog-save" class="save-action"/);
  assert.match(css, /#rules-category-add:hover/);
  assert.match(css, /background:var\(--bg\)/);
  assert.match(css, /box-shadow:none/);
  assert.match(css, /focus-visible/);
});

test('new UI stylesheet loads last', () => {
  assert.ok(html.indexOf('styles/ui-v154.css') > html.indexOf('styles/ui-v153.css'));
});
