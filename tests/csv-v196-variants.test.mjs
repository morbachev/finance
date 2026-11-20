import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyCardCsv,parseCardCsv} from '../dist/src/importers/card-csv.js';
const merchant='架空店舗';
const base=(header)=>`${header}\n2026/7/3,${merchant},1300,1,1,1300\n,,,,,1300\n`;
test('headers may contain 3 columns, title rows, extra metadata, and alternate card spellings',()=>{
  const cases=[
    ['架空名,****1111,三井住友カードVISA(NL)','smbc-nl'],
    ['カード名: Amazon Mastercard','amazon'],
    ['ご利用明細\n架空名,****1111,GOLD POINT CARD +,,,備考','goldpoint'],
    ['利用明細\n架空名,****1111,Ａｍａｚｏｎマスター,追加メタデータ','amazon'],
  ];
  for(const [header,card] of cases){
    const data=base(header);
    assert.equal(identifyCardCsv(data,'202608.csv').cardId,card);
    const parsed=parseCardCsv(data,'202608.csv','2026-08-10');
    assert.equal(parsed.rows.length,1);
    assert.equal(parsed.statedTotal,1300);
  }
});
test('malformed and unknown issuer headers cannot silently be imported',()=>{
  assert.throws(()=>identifyCardCsv(base('架空名,****1111,未対応カード'),'202608.csv'),/カード名/);
  assert.throws(()=>identifyCardCsv(base('架空名,****1111,三井住友カードVISA(NL),Amazon Mastercard'),'202608.csv'),/複数/);
  assert.throws(()=>parseCardCsv(base('架空名,****1111,三井住友カードVISA(NL)').replace(',,,,,1300',',,,,,1299'),'202608.csv','2026-08-10'),/一致しません/);
});
