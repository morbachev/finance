import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCardCsv} from '../dist/src/importers/card-csv.js';

const header='架空名義,4980-05**-****-****,三井住友カードＶＩＳＡ（ＮＬ）,,,';
const sample=(lines)=>[header,...lines].join('\r\n');
const detail='テスト名義　様,6900-11**-****-****,ＧｏｏｇｌｅＰａｙ／ｉＤ,,,';
const normal='2026/8/9,架空の店舗,1000,1,1,1000';
const refund='2026/8/15,キャッシュバック（ポイント交換）,,,,-300';
const after='2026/8/2,架空の店舗B,200,1,1,200';

test('Vpass cashback with blank payment columns reduces the total, masked-card detail is not a transaction',()=>{
  const s=parseCardCsv(sample([normal,refund,detail,after,',,,,,900']),'202609.csv','2026-09-10');
  assert.equal(s.rows.length,3);
  assert.deepEqual(s.rows.map(row=>row.amount),[1000,-300,200]);
  assert.deepEqual(s.rows.map(row=>row.id),['row-1','row-2','row-3']);
  assert.deepEqual(s.rows.map(row=>row.sourceLine),[2,3,5]);
  assert.equal(s.statedTotal,900);
  assert.equal(s.rows[1].merchant,'キャッシュバック(ポイント交換)');
  assert.ok(!JSON.stringify(s).includes('6900-11'));
  assert.ok(!JSON.stringify(s).includes('テスト名義'));
  assert.equal(s.warnings.length,0);
});

test('cashback does not bypass exact invoice-total verification',()=>{
  assert.throws(()=>parseCardCsv(sample([normal,refund,detail,after,',,,,,901']),'202609.csv',null),/一致しません/);
});

test('unknown uncharged rows and positive missing-payment rows are rejected',()=>{
  assert.throws(()=>parseCardCsv(sample([normal,'任意の補助行,説明文,,,,',',,,,,1000']),'202609.csv',null),/不正/);
  assert.throws(()=>parseCardCsv(sample([normal,'2026/8/15,架空の売上,,,,300',',,,,,1300']),'202609.csv',null),/不正/);
  assert.throws(()=>parseCardCsv(sample([normal,'2026/8/15,架空の返金,,1,,-300',',,,,,700']),'202609.csv',null),/不正/);
});

test('cardholder detail without masked number is rejected',()=>{
  const invalid='テスト名義 様,1234567890123456,Google Pay / iD,,,';
  assert.throws(()=>parseCardCsv(sample([normal,invalid,',,,,,1000']),'202609.csv',null),/不正/);
});
