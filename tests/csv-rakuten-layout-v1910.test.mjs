import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCardCsv} from '../dist/src/importers/card-csv.js';
import {parseStatementText} from '../dist/src/importers/statement-parser.js';
import {importErrors} from '../dist/src/importers/batch-policy.js';
const base=(lines)=>['架空,****1111,三井住友カードＶＩＳＡ（ＮＬ）,,,',...lines].join('\r\n');
const row='2026/7/9,架空店舗,1300,1,1,1300';
test('CSV total followed by empty padded lines and issuer note is accepted',()=>{
 const csv=base([row,',,,,,1300',',,,,,','※明細の備考']);
 const s=parseCardCsv(csv,'202608.csv',null);
 assert.equal(s.rows.length,1);assert.equal(s.statedTotal,1300);
});
test('CSV total may be labeled in header or penultimate column, with trailing empty cells',()=>{
 for(const end of ['合計,,,,,1300,,','ご請求金額合計,1300,,,,','お支払い金額合計,,,,,1300']){
   const s=parseCardCsv(base([row,end]),'202608.csv',null);
   assert.equal(s.statedTotal,1300);
 }
});
test('CSV must reject erroneous or ambiguous totals, unknown content after total, and missing totals',()=>{
 assert.throws(()=>parseCardCsv(base([row,',,,,,1299',',,,,,']),'202608.csv',null),/一致しません/);
 assert.throws(()=>parseCardCsv(base([row,',,,,,1300',',,,,,1300']),'202608.csv',null),/特定できません/);
 assert.throws(()=>parseCardCsv(base([row,',,,,,1300','隠れた取引,1000']),'202608.csv',null),/未対応/);
 assert.throws(()=>parseCardCsv(base([row,',,,,,']),'202608.csv',null),/特定できません/);
});
test('Rakuten card is ambiguous even when all transactions are ETC; user must select one',()=>{
 const sample=`楽天カード株式会社\nお支払日 2026年11月27日\n2026年11月ご請求金額 1,000円\n利用日 利用店名 利用者 支払方法\n2026/10/03 ETCカード売上 ETC* 1回払い 1000 0 1000 1000 1000 0`;
 const s=parseStatementText(sample,'paste','明細');
 assert.equal(s.provider,'rakuten');assert.equal(s.cardId,null);
 assert.ok(importErrors(s,false).includes('カード種別が不明です'));
 s.cardId='rakuten-etc';assert.ok(!importErrors(s,false).includes('カード種別が不明です'));
 s.cardId='rakuten-mizuho';assert.ok(!importErrors(s,false).includes('カード種別が不明です'));
});
test('Rakuten radio is only in import summary; sidebar theme and import min-height have layout rules',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/styles/layout-v1910.css',import.meta.url),'utf8');
 assert.match(html,/id="import-rakuten-choice"/);
 assert.match(html,/value="rakuten-etc"/);assert.match(html,/value="rakuten-mizuho"/);
 assert.match(js,/s\.provider!=='rakuten'/);assert.match(js,/s\.cardId=input\.value/);
 assert.match(css,/results-grid\{flex:1 0 auto/);
 assert.match(css,/sidebar-theme\{border-top:0!important/);
});
