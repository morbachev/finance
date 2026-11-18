import test from 'node:test';
import assert from 'node:assert/strict';
import {futureProjection,suggestedNisaMonthly,targetMonthForAge} from '../dist/src/cloud/future-projection.js';
import {canonicalStatementFilename} from '../dist/src/ui/statement-filename.js';
import {emptyAssets} from '../dist/src/cloud/assets.js';

const clone=o=>structuredClone(o);
const now='2026-11-17';
const saved=(id,amount)=>({id:id+'-snap001',accountId:id,balance:amount,observedAt:'2026-11-01T12:00:00+09:00'});
const deposit=(name='現金貯金への振替',amount=10000)=>({id:'cash-transfer-001',name,amount,kind:'transfer',fromAccountId:'rakuten-bank',toAccountId:'cash-savings',frequency:'monthly',dayOfMonth:20,monthOfYear:null,weekday:null,startOn:'2026-01-01',endOn:null,categoryId:null,enabled:true});
const base=()=>{
  const doc=emptyAssets();
  doc.snapshots=[saved('cash-savings',50000),saved('nisa',100000)];
  doc.recurring=[deposit()];
  return doc;
};
const options={today:now,targetMonth:'2027-01',changeMonth:'2026-12',savingsRuleId:'cash-transfer-001',savingsAmount:20000,nisaMonthly:20000,nisaAnnualReturn:0};

test('future scheduled savings are included in current month and future months',()=>{
  const r=futureProjection(base(),[],options);
  assert.equal(r.target.cash,80000);
  assert.equal(r.target.cashScenario,100000);
  assert.equal(r.target.nisa,140000);
  assert.equal(r.target.combined,220000);
  assert.equal(r.target.combinedScenario,240000);
});
test('scenario changes only after chosen month',()=>{
  const r=futureProjection(base(),[],{...options,changeMonth:'2027-01'});
  assert.equal(r.target.cash,80000);assert.equal(r.target.cashScenario,90000);
});
test('no selected rule makes scenario identical to baseline',()=>{
  const r=futureProjection(base(),[],{...options,savingsRuleId:null});
  assert.equal(r.target.cash,r.target.cashScenario);
});
test('year boundary and target month are inclusive',()=>{
  const r=futureProjection(base(),[],{...options,targetMonth:'2026-12'});
  assert.deepEqual(r.points.map(p=>p.month),['2026-11','2026-12']);
  assert.equal(r.target.cash,70000);
});
test('disabled and expired scheduled transfers do not apply',()=>{
  const d=base();d.recurring[0].endOn='2026-11-18';
  const r=futureProjection(d,[],{...options,savingsRuleId:null});
  assert.equal(r.target.cash,50000);
});
test('NISA annual return is compounded monthly and changes neither cash variant',()=>{
  const zero=futureProjection(base(),[],options);
  const withReturn=futureProjection(base(),[],{...options,nisaAnnualReturn:0.05});
  assert.equal(withReturn.target.cash,zero.target.cash);
  assert.equal(withReturn.target.cashScenario,zero.target.cashScenario);
  assert.ok(withReturn.target.nisa>zero.target.nisa);
});
test('zero growth and no future NISA cards keep the registered valuation',()=>{
  const r=futureProjection(base(),[],{...options,nisaMonthly:0});
  assert.equal(r.target.nisa,100000);
});
test('recurring NISA transfers exclude additional inferred card deposits',()=>{
  const d=base();d.recurring.push({...deposit('NISA積立',15000),id:'nisa-transfer-001',toAccountId:'nisa'});
  const r=futureProjection(d,[],{...options,nisaMonthly:0});
  assert.equal(r.hasNisaSchedule,true);
  assert.equal(r.target.nisa,145000);
  assert.throws(()=>futureProjection(d,[],options),/重ねられません/);
});
test('missing confirmed snapshots stay missing, not zero',()=>{
  const d=base();d.snapshots=d.snapshots.filter(v=>v.accountId!=='nisa');
  const r=futureProjection(d,[],options);
  assert.equal(r.target.nisa,null);assert.equal(r.target.combined,null);
  assert.equal(r.target.cashScenario,100000);
});
test('cash savings expenses and withdrawals reduce expected balance',()=>{
  const d=base();d.recurring.push({...deposit('貯金から支払',5000),id:'cash-expense-001',kind:'expense',fromAccountId:'cash-savings',toAccountId:null});
  const r=futureProjection(d,[],{...options,savingsRuleId:null});
  assert.equal(r.target.cash,65000);
});
test('age target uses actual birth month and never guesses day',()=>{
  assert.equal(targetMonthForAge('2003-05',40),'2043-05');
  assert.equal(targetMonthForAge('2003-05',0),null);
  assert.equal(targetMonthForAge('2003-13',40),null);
});
test('bad target dates and negative amounts fail closed',()=>{
  assert.throws(()=>futureProjection(base(),[],{...options,targetMonth:'2026-10'}),/不正/);
  assert.throws(()=>futureProjection(base(),[],{...options,savingsAmount:-1}),/不正/);
  assert.throws(()=>futureProjection(base(),[],{...options,nisaAnnualReturn:0.4}),/不正/);
});
test('name is standardized independently of issuer-provided sourceName',()=>{
  const statement={cardId:'rakuten-mizuho',billingMonth:'2026-11',paymentDate:'2026-11-27',sourceName:'download (3).pdf'};
  assert.equal(canonicalStatementFilename(statement),'202611_みずほ楽天カード_明細.pdf');
  assert.equal(canonicalStatementFilename(statement,'12345678-1234-1234-1234-123456789abc'),'202611_みずほ楽天カード_明細.pdf');
});
test('unknown cards generate safe filename and valid date fallback',()=>{
  const statement={cardId:null,billingMonth:null,paymentDate:'2026-12-10',sourceName:'../../secret'};
  assert.equal(canonicalStatementFilename(statement),'202612_カード種別未設定_明細.pdf');
});
test('latest matching NISA card month can seed an editable assumption',()=>{
  const d=base();d.nisaCardRule={cardId:'rakuten-mizuho',merchantContains:'楽天証券',enabled:true};
  const records=[{id:'card-1',statement:{cardId:'rakuten-mizuho',rows:[{id:'row-1',usedOn:'2026-10-20',merchant:'楽天証券',amount:20000}]}}];
  const suggested=suggestedNisaMonthly(d,records,now);
  assert.equal(suggested.amount,20000);
});
test('old card samples are not projected forever',()=>{
  const d=base();d.nisaCardRule={cardId:'rakuten-mizuho',merchantContains:'楽天証券',enabled:true};
  const records=[{id:'card-1',statement:{cardId:'rakuten-mizuho',rows:[{id:'row-1',usedOn:'2025-01-20',merchant:'楽天証券',amount:20000}]}}];
  assert.equal(suggestedNisaMonthly(d,records,now).amount,0);
});
