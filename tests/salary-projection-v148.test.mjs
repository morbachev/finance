import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedMainSalaries,forecastBankBalances} from '../dist/src/cloud/salary-projection.js';
import {emptyAssets} from '../dist/src/cloud/assets.js';

const salary=(id,paidOn,netPay=200000,patch={})=>({id,employerId:'main',payPeriod:paidOn.slice(0,7),paidOn,
  grossPay:240000,netPay,taxablePay:235000,currency:'JPY',kind:'salary',revision:1,...patch});
const snap=(id,accountId,balance)=>({id,accountId,balance,observedAt:'2026-11-16T08:00:00.000Z'});
const transfer=(id,monthDay=27)=>({id,name:'現金貯金へ振替',amount:10000,kind:'transfer',fromAccountId:'rakuten-bank',toAccountId:'cash-savings',frequency:'monthly',dayOfMonth:monthDay,monthOfYear:null,weekday:null,startOn:'2026-11-01',endOn:null,categoryId:null,enabled:true});
function doc(){return {...emptyAssets(),snapshots:[snap('a','rakuten-bank',100000),snap('b','cash-savings',50000)],recurring:[transfer('t1')]};}
const today='2026-11-17',target='2026-12-31';

test('missing November salary is estimated using October net minus non-taxable support',()=>{
  const items=expectedMainSalaries([salary('oct','2026-10-27')],today,target);
  assert.deepEqual(items.map(i=>[i.date,i.amount,i.method]),[
    ['2026-11-27',195000,'net-excluding-nontaxable'],
    ['2026-12-27',195000,'net-excluding-nontaxable']]);
});
test('bank forecast includes two unconfirmed salaries but not transfers as household income',()=>{
  const result=forecastBankBalances(doc(),target,[],[salary('oct','2026-10-27')],'rakuten-bank',today);
  assert.equal(result.estimatedByAccount['rakuten-bank'],390000);
  assert.equal(result.accounts['rakuten-bank'].balance,100000-20000+390000);
  assert.equal(result.accounts['cash-savings'].balance,50000+20000);
  assert.equal(result.estimates.length,2);
});
test('actual salary replaces estimate for same month',()=>{
  const result=forecastBankBalances(doc(),target,[],[salary('oct','2026-10-27'),salary('nov','2026-11-27',215000)],'rakuten-bank',today);
  assert.equal(result.estimates.length,1);
  assert.equal(result.estimates[0].date,'2026-12-27');
  assert.equal(result.accounts['rakuten-bank'].balance,100000-20000+215000+195000);
});
test('missing taxable breakdown uses previous net, bonus is never a basis',()=>{
  const list=expectedMainSalaries([salary('oct','2026-10-27',202000,{grossPay:null,taxablePay:null}),salary('bonus','2026-11-05',900000,{kind:'bonus'})],today,target);
  assert.equal(list.length,2);
  assert.equal(list[0].amount,202000);
  assert.equal(list[0].method,'previous-net');
});
test('salary recurring income in same target account is not added twice',()=>{
  const data=doc();data.recurring.push({...transfer('pay'),name:'給与',kind:'income',amount:190000,fromAccountId:null,toAccountId:'rakuten-bank'});
  const result=forecastBankBalances(data,target,[],[salary('oct','2026-10-27')],'rakuten-bank',today);
  assert.equal(result.estimates.length,0);
});
test('no linked deposit account, no recent salary or no reference balance never invents deposits',()=>{
  const noLink=forecastBankBalances(doc(),target,[],[salary('oct','2026-10-27')],null,today);
  assert.equal(noLink.estimates.length,0);
  assert.equal(expectedMainSalaries([salary('jun','2026-06-27')],today,target).length,0);
  const empty=forecastBankBalances(emptyAssets(),target,[],[salary('oct','2026-10-27')],'rakuten-bank',today);
  assert.equal(empty.accounts['rakuten-bank'].balance,null);
  assert.equal(empty.estimates.length,0);
});
test('future bonus is not silently projected and beyond following month is not estimated',()=>{
  const list=expectedMainSalaries([salary('oct','2026-10-27')],today,'2027-05-31');
  assert.deepEqual(list.map(i=>i.date),['2026-11-27','2026-12-27']);
});
