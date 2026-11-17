import test from 'node:test';
import assert from 'node:assert/strict';
import { importErrors, duplicateMonths } from '../dist/src/importers/batch-policy.js';

const makeStatement = (patch = {}) => ({
  provider:'smbc', cardId:'amazon', sourceKind:'paste',sourceName:'架空の明細',
  billingMonth:'2026-12',paymentDate:'2026-12-28',statedTotal:643,
  confirmation:'provisional',warnings:[],
  rows:[{id:'a',usedOn:'2026-11-02',merchant:'架空店舗',amount:643}],
  ...patch,
});

test('batch verification accepts provisional with consistent totals', () => {
  assert.deepEqual(importErrors(makeStatement(), false), []);
});
test('batch verification blocks malformed and mismatched statements', () => {
  const issues=importErrors(makeStatement({statedTotal:644,rows:[{id:'a',usedOn:'2026-15-02',merchant:'',amount:643}]}),false);
  assert.ok(issues.some(x => x.includes('一致')));
  assert.ok(issues.some(x => x.includes('不備')));
});
test('batch verification requires PDF original and valid card', () => {
  assert.ok(importErrors(makeStatement({sourceKind:'pdf',cardId:null}),false).some(x=>x.includes('PDF原本')));
  assert.deepEqual(importErrors(makeStatement({sourceKind:'pdf'}),true),[]);
});
test('batch verification blocks duplicated card and month', () => {
  const conflicts=duplicateMonths([makeStatement(),makeStatement(),makeStatement({cardId:'smbc-nl'})]);
  assert.deepEqual([...conflicts],[0,1]);
});
