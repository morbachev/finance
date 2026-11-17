import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Rendering a statement must never recursively re-render the entire page.
test('renderSummary must not recursively invoke render', () => {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const begin = source.indexOf('function renderSummary(): void {');
  const end = source.indexOf('\nfunction makeInput(', begin);
  assert.ok(begin >= 0 && end > begin);
  const summary = source.slice(begin, end);
  assert.doesNotMatch(summary, /\brender\s*\(/);
});
