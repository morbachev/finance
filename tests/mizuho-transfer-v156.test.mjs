import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyAssets, validateAssets, mergeAssets } from '../dist/src/cloud/assets.js';
import { estimateMizuhoTransferAmount, mizuhoTransferForBill } from '../dist/src/cloud/mizuho-transfer.js';
import { bankTimeline } from '../dist/src/summary/bank-timeline.js';
import { forecastBankBalances } from '../dist/src/cloud/salary-projection.js';
const snap=(id,account,balance,date='2026-11-16T00:00:00Z')=>({id,accountId:account,balance,observedAt:date});
const plan={enabled:true,leadDays:3,extraForSmallBills:true};
const bill=(amount,date='2026-11-27')=>({id:'record-1',statement:{provider:'rakuten',cardId:'rakuten-mizuho',sourceKind:'paste',sourceName:'test.pdf',billingMonth:'2026-10',paymentDate:date,statedTotal:amount,confirmation:'confirmed',warnings:[],rows:[{id:'row-1',usedOn:'2026-10-10',merchant:'SHOP',amount}]}});
const data=(amount=24245)=>({...emptyAssets(),mizuhoTransferPlan:plan,cardDebitAccounts:{'rakuten-mizuho':'mizuho-bank'},snapshots:[snap('snap-r','rakuten-bank',100000),snap('snap-m','mizuho-bank',0)],recurring:[]});
const source=(doc,amount=24245)=>({records:[bill(amount)],rules:[],categories:[],assets:doc,payroll:{ready:false,syncedAt:null,entries:[]},currentPeriod:'2026-11'});
test('send target is 5,000-yen units, with an optional small-charge reserve',()=>{
 assert.equal(estimateMizuhoTransferAmount(24245,true),30000);
 assert.equal(estimateMizuhoTransferAmount(24245,false),25000);
 assert.equal(estimateMizuhoTransferAmount(160500,true),165000);
 assert.equal(estimateMizuhoTransferAmount(0),0);
 assert.throws(()=>estimateMizuhoTransferAmount(-1));
});
test('timeline debits Rakuten at transfer date, not the card settlement date',()=>{
 const doc=data();const results=bankTimeline('2026-11',source(doc),'2026-11-17');
 assert.deepEqual(results.days.map(day=>[day.date,day.delta,day.balance]),[['2026-11-24',-30000,70000]]);
 assert.equal(results.endBalance,70000);
 assert.equal(results.minimum,70000);
});
test('bank projection credits Mizuho then debits card, no double debit at Rakuten',()=>{
 const doc=data();const results=forecastBankBalances(doc,'2026-11-30',[bill(24245)],[],null,'2026-11-17');
 assert.equal(results.accounts['rakuten-bank'].balance,70000);
 assert.equal(results.accounts['mizuho-bank'].balance,5755);
 assert.equal(results.cardDebitByAccount['mizuho-bank'],24245);
 assert.equal(results.cardDebitByAccount['rakuten-bank']??0,0);
 assert.equal(results.autoTransferByAccount['rakuten-bank'],-30000);
 assert.equal(results.autoTransferByAccount['mizuho-bank'],30000);
});
test('snapshot after predicted transfer excludes past transfer for that account',()=>{
 const doc=data();doc.snapshots.push(snap('snap-new','rakuten-bank',80000,'2026-11-25T00:00:00Z'));
 const results=forecastBankBalances(doc,'2026-11-30',[bill(24245)],[],null,'2026-11-17');
 assert.equal(results.accounts['rakuten-bank'].balance,80000);
 assert.equal(results.accounts['mizuho-bank'].balance,5755);
});
test('disabled prediction and manual transfer do not produce duplicate auto transfers',()=>{
 const doc=data();assert.equal(mizuhoTransferForBill({cardId:'rakuten-mizuho',paymentDate:'2026-11-27',amount:24245},{...doc,mizuhoTransferPlan:{...plan,enabled:false}}),null);
 doc.recurring=[{id:'manual-1',name:'みずほへ送金',amount:30000,kind:'transfer',fromAccountId:'rakuten-bank',toAccountId:'mizuho-bank',frequency:'monthly',dayOfMonth:24,monthOfYear:null,weekday:null,startOn:'2026-01-01',endOn:null,categoryId:null,enabled:true}];
 assert.equal(mizuhoTransferForBill({cardId:'rakuten-mizuho',paymentDate:'2026-11-27',amount:24245},doc),null);
});
test('optional settings preserve legacy assets and merge independent modifications',()=>{
 const base=emptyAssets();assert.deepEqual(validateAssets(base),base);
 const local={...base,mizuhoTransferPlan:plan};
 const remote={...base,cardDebitAccounts:{amazon:'rakuten-bank'}};
 const merged=mergeAssets(base,local,remote);
 assert.deepEqual(merged.mizuhoTransferPlan,plan);
 assert.equal(merged.cardDebitAccounts.amazon,'rakuten-bank');
 assert.throws(()=>validateAssets({...base,mizuhoTransferPlan:{...plan,leadDays:33}}));
});

test('a transfer scheduled at month end for a next-month card debit appears in the earlier month',()=>{
 const doc=data();const due=bill(24245,'2026-12-02');
 const sourceForDec={...source(doc),records:[due]};
 const november=bankTimeline('2026-11',sourceForDec,'2026-11-17');
 assert.deepEqual(november.days.map(x=>[x.date,x.delta]),[['2026-11-29',-30000]]);
 const forecast=forecastBankBalances(doc,'2026-11-30',[due],[],null,'2026-11-17');
 assert.equal(forecast.accounts['rakuten-bank'].balance,70000);
 assert.equal(forecast.accounts['mizuho-bank'].balance,30000);
});
