import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizedIndices, orderedPreviewRows } from '../dist/src/ui/preview-order.js';

test('STEP 02: review precedes provisional, then verified; within a state insertion order stays stable', () => {
  const drafts = [
    { name: 'verified A', rank: 2 },
    { name: 'provisional A', rank: 1 },
    { name: 'review A', rank: 0 },
    { name: 'verified B', rank: 2 },
    { name: 'review B', rank: 0 },
    { name: 'provisional B', rank: 1 },
  ];
  assert.deepEqual(prioritizedIndices(drafts, item => item.rank), [2, 4, 1, 5, 0, 3]);
  assert.deepEqual(drafts.map(x => x.name), ['verified A','provisional A','review A','verified B','review B','provisional B']);
});

test('STEP 03: sorts date ascending/descending using ISO date, not merchant or string amount', () => {
  const rows = [
    { id:'one', usedOn:'2026-11-09',amount:2000 },
    { id:'two', usedOn:'2026-10-22',amount:50 },
    { id:'three',usedOn:'2026-11-09',amount:100 },
  ];
  assert.deepEqual(orderedPreviewRows(rows,{key:'usedOn',direction:'asc'}).map(x=>x.id), ['two','one','three']);
  assert.deepEqual(orderedPreviewRows(rows,{key:'usedOn',direction:'desc'}).map(x=>x.id), ['one','three','two']);
  assert.deepEqual(rows.map(x=>x.id), ['one','two','three'], 'do not modify original rows');
});

test('STEP 03: sorts numerically and preserves source ordering for tied amounts', () => {
  const rows = [
    { id:'one', usedOn:'2026-11-01',amount:500 },
    { id:'two', usedOn:'2026-11-02',amount:20 },
    { id:'three', usedOn:'2026-11-03',amount:500 },
  ];
  assert.deepEqual(orderedPreviewRows(rows,{key:'amount',direction:'asc'}).map(x=>x.id), ['two','one','three']);
  assert.deepEqual(orderedPreviewRows(rows,{key:'amount',direction:'desc'}).map(x=>x.id), ['one','three','two']);
  assert.deepEqual(orderedPreviewRows(rows,null).map(x=>x.id), ['one','two','three']);
});

test('STEP 03: success banner is below card metadata, while error notices keep their old position', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
  const successPos = html.indexOf('id="verification-ok"');
  assert.ok(successPos > html.indexOf('id="detail-count"'));
  assert.ok(successPos < html.indexOf('id="notice-list"'));
  assert.match(html, /id="sort-date"/);
  assert.match(html, /id="sort-amount"/);
});
