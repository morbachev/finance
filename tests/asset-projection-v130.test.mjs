import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {emptyAssets, validateAssets, mergeAssets} from '../dist/src/cloud/assets.js';
import {forecastAssets, matchingNisaRows, lastDayOfNextMonth} from '../dist/src/cloud/asset-projection.js';
import {LiveVault} from '../dist/src/cloud/live-vault.js';
import {deriveCloudKey, decryptAssets} from '../dist/src/cloud/cloud-crypto.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const observedAt='2026-11-16T12:00:00.000Z';
const snap=(id,accountId,balance,at=observedAt)=>({id,accountId,balance,observedAt:at});
const transfer=(id,patch={})=>({id,name:'貯蓄口座への定期送金',amount:10000,kind:'transfer',fromAccountId:'rakuten-bank',toAccountId:'cash-savings',frequency:'monthly',dayOfMonth:27,monthOfYear:null,weekday:null,startOn:'2026-11-01',endOn:null,categoryId:null,enabled:true,...patch});
const record=(id,rows,cardId='rakuten-mizuho')=>({id,statement:{cardId,rows:rows.map((row,i)=>({id:`row-${i}`,merchant:row.merchant,usedOn:row.date,amount:row.amount}))}});
function doc(){return {...emptyAssets(),snapshots:[snap('snap-main','rakuten-bank',200000),snap('snap-cash','cash-savings',100000),snap('snap-nisa','nisa',500000)],recurring:[transfer('transfer-one')]};}
test('recurring transfers affect both balances from day AFTER snapshot without changing aggregate assets',()=>{
 const before=forecastAssets(doc(),'2026-11-16');
 assert.equal(before['rakuten-bank'].balance,200000);
 const after=forecastAssets(doc(),'2026-11-27');
 assert.equal(after['rakuten-bank'].balance,190000);
 assert.equal(after['cash-savings'].balance,110000);
 assert.equal(after.nisa.balance,500000);
 assert.equal(after['rakuten-bank'].balance+after['cash-savings'].balance,300000);
 const second=forecastAssets(doc(),'2026-12-31');
 assert.equal(second['rakuten-bank'].balance,180000);
 assert.equal(second['cash-savings'].balance,120000);
 assert.equal(second['rakuten-bank'].forecastEvents,2);
});
test('nonexistent 31st clamps to end of month, yearly and weekly honor start/end/disabled',()=>{
 const data={...doc(),recurring:[
   transfer('monthly-31',{dayOfMonth:31}),
   transfer('year-end',{kind:'expense',toAccountId:null,amount:2000,frequency:'yearly',monthOfYear:12,dayOfMonth:0,startOn:'2026-12-01'}),
   transfer('weekly',{kind:'income',fromAccountId:null,toAccountId:'rakuten-bank',amount:500,frequency:'weekly',dayOfMonth:null,weekday:3,startOn:'2026-11-18',endOn:'2026-11-25'}),
   transfer('disabled',{enabled:false})
 ]};
 const november=forecastAssets(data,'2026-11-30');
 assert.equal(november['rakuten-bank'].balance,191000); // -10000 + 2*500
 assert.equal(november['cash-savings'].balance,110000);
 const december=forecastAssets(data,'2026-12-31');
 assert.equal(december['rakuten-bank'].balance,179000); // second -10000 and year-end -2000
});
test('a snapshot on the 27th excludes all events of that day; newer snapshot becomes the only baseline',()=>{
 const data={...doc(),snapshots:[...doc().snapshots,snap('snapshot-latest','rakuten-bank',180000,'2026-11-27T12:00:00Z')]};
 assert.equal(forecastAssets(data,'2026-11-27')['rakuten-bank'].balance,180000);
 assert.equal(forecastAssets(data,'2026-12-27')['rakuten-bank'].balance,170000);
 assert.equal(forecastAssets(data,'2026-11-16')['rakuten-bank'].balance,200000);
});
test('NISA auto contributions require explicit merchant AND card; refunds and malformed dates are excluded',()=>{
 const data={...doc(),nisaCardRule:{cardId:'rakuten-mizuho',merchantContains:'楽天証券',enabled:true}};
 const records=[record('a',[
  {merchant:'ラクテンショウケン',date:'2026-11-23',amount:1000},
  {merchant:'楽天証券 投信積立',date:'2026-11-24',amount:20000},
  {merchant:'楽天証券',date:'2026-11-16',amount:3000},
  {merchant:'楽天証券',date:'2026-11-25',amount:-2000},
  {merchant:'楽天証券',date:'2026-13-99',amount:2000}
 ]),record('b',[{merchant:'楽天証券',date:'2026-11-28',amount:30000}],'smbc-nl')];
 assert.equal(matchingNisaRows(data,records).length,2);
 assert.equal(forecastAssets(data,'2026-11-30',records).nisa.balance,520000);
 assert.equal(forecastAssets(data,'2026-11-30',records)['rakuten-bank'].balance,190000,'card charge does not debit unmapped bank');
 data.nisaCardRule=null;
 assert.equal(forecastAssets(data,'2026-11-30',records).nisa.balance,500000);
});
test('legacy assets file without investment linkage reads as unlinked and does not guess savings',()=>{
 const legacy=doc();delete legacy.nisaCardRule;
 assert.equal(validateAssets(legacy).nisaCardRule,null);
 assert.equal(forecastAssets({...emptyAssets()},'2026-11-30').nisa.balance,null);
 assert.equal(lastDayOfNextMonth(new Date(2026,11,15)),'2027-01-31');
});
test('three-way merge combines new link with independent snapshots and tracks same-field conflict',()=>{
 const base=doc(),left=structuredClone(base),right=structuredClone(base);
 left.nisaCardRule={cardId:'rakuten-mizuho',merchantContains:'楽天証券',enabled:true};
 right.snapshots.push(snap('other-bank','nisa',555000,'2026-11-20T00:00:00Z'));
 const merged=mergeAssets(base,left,right);
 assert.equal(merged.nisaCardRule.merchantContains,'楽天証券');
 assert.equal(merged.snapshots.length,4);
 const other=structuredClone(right);other.nisaCardRule={cardId:'smbc-nl',merchantContains:'楽天証券',enabled:true};
 const collision=mergeAssets(base,left,other);
 assert.equal(collision.nisaCardRule.cardId,'rakuten-mizuho');
 assert.ok(collision.conflicts.some(c=>c.field==='nisaCardRule'));
});
test('account workspace separated from app settings; Microsoft controls are not duplicated',async()=>{
 const fs=await import('node:fs/promises');
 const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const main=await fs.readFile(new URL('../src/main.ts',import.meta.url),'utf8');
 assert.match(html,/id="settings-view"/);
 assert.match(html,/id="nav-settings"/);
 assert.doesNotMatch(html,/id="nav-cloud"/);
 assert.match(html,/id="nav-assets"/);
 assert.match(html,/id="assets-page"/);
 assert.ok(html.indexOf('id="assets-view"')<html.indexOf('id="settings-view"'));
 assert.ok(html.indexOf('id="assets-page"')<html.indexOf('id="assets-view"'));
 assert.ok(html.indexOf('id="settings-view"')<html.indexOf('id="cloud-view"'));
 assert.match(main,/view === 'assets'/);
 assert.match(main,/view === 'settings'/);
 for(const id of ['cloud-rotate-form','cloud-client-id','cloud-login','assets-nisa-link-form','assets-balances-form']){
  assert.equal(html.match(new RegExp(`id="${id}"`,'g'))?.length,1);
 }
});
