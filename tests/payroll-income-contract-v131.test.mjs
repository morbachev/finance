import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePayrollIncome,combinePayrollIncome,incomeByMonth,incomeByYear,depositedIncomeBetween } from '../dist/src/cloud/payroll-income.js';
import { forecastAssets } from '../dist/src/cloud/asset-projection.js';
import { emptyAssets } from '../dist/src/cloud/assets.js';
const income=(id,period,paidOn,grossPay,netPay,kind='salary')=>({id,employerId:'main-company',payPeriod:period,paidOn,grossPay,netPay,taxablePay:null,currency:'JPY',kind,revision:1});
const doc=(entries,year=2026,deletedIds=[])=>({format:'payroll-income-v1',year,updatedAt:'2026-11-16T10:00:00Z',entries,deletedIds});
const salary=income('sal-oct','2026-10','2026-11-27',250000,201000);
const bonus=income('bonus-dec','2026-12','2026-12-15',150000,120000,'bonus');
const prior=income('sal-dec25','2025-12','2026-01-27',240000,195000);
test('支給日ベースで集計: 対象年月と支給年月を混同しない',()=>{
 const all=combinePayrollIncome([validatePayrollIncome(doc([salary,bonus,prior]))]);
 const months=incomeByMonth(all),years=incomeByYear(all);
 assert.deepEqual(months.get('2026-11'),{grossPay:250000,netPay:201000,count:1});
 assert.deepEqual(months.get('2026-12'),{grossPay:150000,netPay:120000,count:1});
 assert.deepEqual(years.get('2026'),{grossPay:640000,netPay:516000,count:3});
});
test('削除済み記録は収入として計上しない',()=>{
 const data=validatePayrollIncome(doc([salary,bonus],2026,['sal-oct']));
 assert.deepEqual(data.entries.map(x=>x.id),['bonus-dec']);
});
test('年別ファイル間の給与ID重複はエラー',()=>{
 const bad=validatePayrollIncome(doc([income('sal-oct','2025-11','2025-12-27',1,1)],2025));
 assert.throws(()=>combinePayrollIncome([bad,validatePayrollIncome(doc([salary]))]),/重複/);
});
test('不正日付、負額、通貨・重複・異年度は受け付けない',()=>{
 for(const corrupted of [
  {...salary,paidOn:'2026-02-30'},
  {...salary,netPay:-1},
  {...salary,currency:'USD'},
  {...salary,paidOn:'2025-11-27'},
  {...salary,revision:0},
 ]) assert.throws(()=>validatePayrollIncome(doc([corrupted])));
 assert.throws(()=>validatePayrollIncome(doc([salary,salary])));
});
test('給料の受取口座が未指定なら銀行残高は変化しない',()=>{
 const base=emptyAssets();base.snapshots.push({id:'base-2026',accountId:'rakuten-bank',balance:100000,observedAt:'2026-11-16T10:00:00Z'});
 assert.equal(forecastAssets(base,'2026-11-30',[],[salary])['rakuten-bank'].balance,100000);
 assert.equal(forecastAssets(base,'2026-11-30',[],[salary],'rakuten-bank')['rakuten-bank'].balance,301000);
 assert.equal(forecastAssets(base,'2026-11-16',[],[salary],'rakuten-bank')['rakuten-bank'].balance,100000);
});
test('残高の確認日を跨いで給与を二重計上しない',()=>{
 const base=emptyAssets();base.snapshots.push({id:'base-nov30',accountId:'rakuten-bank',balance:350000,observedAt:'2026-11-30T12:00:00Z'});
 assert.equal(forecastAssets(base,'2026-12-31',[],[salary,bonus],'rakuten-bank')['rakuten-bank'].balance,470000);
 assert.equal(depositedIncomeBetween([salary,bonus],'2026-11-30','2026-12-31'),120000);
});
test('給与実績なしの場合は未知の給与を勝手に補完しない',()=>{
 const base=emptyAssets();base.snapshots.push({id:'base-2026',accountId:'rakuten-bank',balance:100000,observedAt:'2026-11-16T10:00:00Z'});
 const forecast=forecastAssets(base,'2026-12-31',[],[],'rakuten-bank')['rakuten-bank'];
 assert.equal(forecast.balance,100000);assert.equal(forecast.payrollDelta,0);
});
