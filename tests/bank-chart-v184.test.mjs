import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bankChartData} from '../dist/src/ui/bank-chart-data.js';

const event=(date,amount,kind='card')=>({date,title:'テスト入出金',amount,kind});
const base=(startDay='2026-11-16',days=[],startBalance=100000)=>({startDay,startBalance,endBalance:days.at(-1)?.balance??startBalance,minimum:0,days,missingCardAccounts:[],warning:null});
const day=(date,events,prior)=>({date,items:events,delta:events.reduce((s,x)=>s+x.amount,0),balance:prior+events.reduce((s,x)=>s+x.amount,0)});

test('mid-month bank snapshot never creates chart points before the confirmed baseline',()=>{
 const d=day('2026-11-20',[event('2026-11-20',-25000)],100000);
 const data=bankChartData(base('2026-11-16',[d]),'2026-11');
 assert.deepEqual(data.series.map(p=>[p.date,p.kind,p.balance]),[
  ['2026-11-16','opening',100000],['2026-11-20','event',75000],['2026-11-30','month-end',75000]]);
 assert.equal(data.selectable[1].delta,-25000);
 assert.deepEqual(data.selectable[1].items,d.items);
 assert.equal(data.series.some(p=>p.date<'2026-11-16'),false);
});

test('a historical snapshot before the month uses actual preceding events as the opening forecast',()=>{
 const prev=day('2026-10-28',[event('2026-10-28',20000,'salary')],100000);
 const current=day('2026-11-10',[event('2026-11-10',-40000)],120000);
 const data=bankChartData(base('2026-10-15',[prev,current]),'2026-11');
 assert.equal(data.series[0].date,'2026-11-01');
 assert.equal(data.series[0].balance,120000);
 assert.equal(data.selectable[1].balance,80000);
 assert.equal(data.selectable.at(-1).balance,80000);
});

test('same-day multiple events are one selectable point with accurate delta and all event rows',()=>{
 const events=[event('2026-11-20',-15000),event('2026-11-20',230000,'salary')];
 const data=bankChartData(base('2026-11-01',[day('2026-11-20',events,100000)]),'2026-11');
 assert.equal(data.selectable[1].delta,215000);
 assert.equal(data.selectable[1].items.length,2);
 assert.equal(data.selectable[1].balance,315000);
});

test('first-of-month event supersedes duplicate opening date in selector without changing drawn cash flow',()=>{
 const d=day('2026-11-01',[event('2026-11-01',-30000)],100000);
 const data=bankChartData(base('2026-10-20',[d]),'2026-11');
 assert.equal(data.series.length,3);
 assert.deepEqual(data.series.slice(0,2).map(p=>p.balance),[100000,70000]);
 assert.equal(data.selectable.length,2);
 assert.equal(data.selectable[0].kind,'event');
 assert.equal(data.selectable[0].balance,70000);
});

test('event on last calendar day is not duplicated by a synthetic month-end marker',()=>{
 const d=day('2026-11-30',[event('2026-11-30',-5000)],100000);
 const data=bankChartData(base('2026-11-01',[d]),'2026-11');
 assert.equal(data.series.length,2);
 assert.equal(data.selectable.at(-1).kind,'event');
});

test('single confirmed snapshot with no transactions offers baseline and month-end selection',()=>{
 const data=bankChartData(base('2026-11-16'),'2026-11');
 assert.deepEqual(data.selectable.map(p=>p.kind),['opening','month-end']);
 assert.equal(data.selectable[1].delta,0);
 const last=bankChartData(base('2026-11-30'),'2026-11');
 assert.equal(last.selectable.length,1);
 assert.equal(last.selectable[0].kind,'opening');
});

test('no snapshot and invalid period never invent a zero-based chart',()=>{
 assert.equal(bankChartData(base(null,[],null),'2026-11'),null);
 assert.equal(bankChartData(base('2026-12-01'),'2026-11'),null);
 assert.equal(bankChartData(base(),'2026-13'),null);
});

test('chart DOM supports tap, accessible date buttons, arrow keys, and a complete event panel',()=>{
 const ui=readFileSync(new URL('../src/ui/monthly-summary.ts',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/styles/bank-chart-v184.css',import.meta.url),'utf8');
 assert.match(ui,/group\.addEventListener\('click',\(\)=>choose\(index\)\)/);
 assert.match(ui,/button\.addEventListener\('keydown'/);
 assert.match(ui,/ArrowRight/);assert.match(ui,/ArrowLeft/);assert.match(ui,/Home/);assert.match(ui,/End/);
 assert.match(ui,/aria-pressed/);assert.match(ui,/bankChartData\(timeline,period\)/);
 assert.match(ui,/point\.items\.length/);assert.match(ui,/monthly-bank-all/);
 assert.match(css,/min-height:44px/);
 assert.match(html,/bank-chart-v184\.css/);
 assert.doesNotMatch(ui,/localStorage\.setItem|sessionStorage\.setItem/);
});
