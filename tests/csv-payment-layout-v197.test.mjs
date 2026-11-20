import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCardCsv } from '../dist/src/importers/card-csv.js';
import { importErrors } from '../dist/src/importers/batch-policy.js';
import { planStatementImport } from '../dist/src/importers/import-policy.js';
const header='架空名義,****0000,三井住友カードＶＩＳＡ（ＮＬ）,,,';
const csv=`${header}\n2026/7/5,架空店舗,1300,1,1,1300\n,,,,,1300\n`;
test('CSV is still parsed and kept as a draft if card payment date is not configured',()=>{
 const s=parseCardCsv(csv,'202608.csv',null);
 assert.equal(s.cardId,'smbc-nl');
 assert.equal(s.billingMonth,'2026-08');
 assert.equal(s.statedTotal,1300);
 assert.equal(s.rows.length,1);
 assert.equal(s.confirmation,'confirmed');
 assert.equal(s.paymentDate,null);
 assert.deepEqual(importErrors(s,false),['支払日が不明または不正です']);
 assert.equal(planStatementImport([],s).kind,'add');
 assert.equal(planStatementImport([s],structuredClone(s)).kind,'duplicate');
 // Saving is still blocked until configuration is present.
 s.paymentDate='2026-08-10';
 assert.deepEqual(importErrors(s,false),[]);
});
test('invalid payment date is rejected if a non-null date is explicitly provided',()=>{
 assert.throws(()=>parseCardCsv(csv,'202608.csv','2026-99-99'),/引落日が不正/);
 assert.throws(()=>parseCardCsv(csv,'202608.csv',''),/引落日が不正/);
});
test('CSV missing-date handling stays in the save gate, and settings can hydrate queued drafts',()=>{
 const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
 assert.match(source,/const date=csvPaymentDate\(meta\.cardId,meta\.billingMonth\)/);
 assert.match(source,/parseCardCsv\(text,file\.name,date\)/);
 assert.match(source,/function applyCsvPaymentSettings\(\)/);
 assert.match(source,/function render\(\): void \{\n  applyCsvPaymentSettings\(\)/);
 assert.match(source,/const paymentAction=\$<HTMLButtonElement>\('import-payment-settings'\)/);
 assert.match(source,/missingPaymentCards\.length \? `\$\{missingPaymentCards\.length\}枚のカードの引落日が未設定`/);
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(html,/id="import-payment-settings" class="secondary-action hidden"/);
});
