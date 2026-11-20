/** P1-C: read-only detection of card-paid recurring charges.
 * Payment month is the ONLY period axis. A suggestion never changes household cashflow. */
import { CARDS } from '../models/types.js';
import { displayMerchant, normalizeMerchant } from '../cloud/merchant-rules.js';
import { cardRecurringKey, nisaRuleOnDay, type CardRecurringDecision } from '../cloud/assets.js';
import type { MonthlySource } from '../summary/monthly-summary.js';
import { importErrors } from '../importers/batch-policy.js';

export interface SubscriptionCandidate {
  key:string;cardId:string;cardName:string;merchant:string;
  frequency:'monthly'|'yearly';amount:number;minAmount:number;maxAmount:number;
  months:string[];confidence:'high'|'medium';
}
const periodNumber=(p:string)=>Number(p.slice(0,4))*12+Number(p.slice(5,7))-1;
const validDate=(d:string|null)=>!!d&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(`${d}T00:00:00Z`))&&new Date(`${d}T00:00:00Z`).toISOString().slice(0,10)===d;
const close=(a:number,b:number)=>Math.abs(a-b)<=Math.max(100,Math.round(Math.min(a,b)*0.08));
const median=(items:number[])=>[...items].sort((a,b)=>a-b)[Math.floor(items.length/2)]!;
const todayPeriod=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
interface Observation {period:string; amount:number}
interface Group {cardId:string;merchant:string;values:Observation[]}
/** Detection accepts only valid, confirmed, uniquely-billed statements. */
export function detectCardSubscriptions(source:MonthlySource,asOf=todayPeriod()):SubscriptionCandidate[]{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(asOf))throw new Error('検出対象の年月が不正です。');
  const permittedCards=new Set(CARDS.map(item=>item.id));
  const duplicate=new Map<string,number>();
  for(const {statement:s} of source.records){
    if(!s.cardId||!s.billingMonth)continue;
    const id=`${s.cardId}|${s.billingMonth}`;
    duplicate.set(id,(duplicate.get(id)??0)+1);
  }
  const groups=new Map<string,Group>();
  for(const record of source.records){
    const s=record.statement;
    if(!s.cardId||!permittedCards.has(s.cardId)||s.confirmation!=='confirmed'||!validDate(s.paymentDate)||
       !s.billingMonth||duplicate.get(`${s.cardId}|${s.billingMonth}`)!==1||
       importErrors(s,s.sourceKind!=='pdf'||!!record.originalId).length)continue;
    const period=s.paymentDate!.slice(0,7);
    if(period>asOf||periodNumber(asOf)-periodNumber(period)>37)continue;
    for(const row of s.rows){
      if(!Number.isSafeInteger(row.amount)||row.amount<=0||!validDate(row.usedOn))continue;
      const nisa=nisaRuleOnDay(source.assets,row.usedOn);
      if(nisa?.enabled&&nisa.cardId===s.cardId&&normalizeMerchant(row.merchant).includes(normalizeMerchant(nisa.merchantContains)))continue;
      const merchant=displayMerchant(row.merchant,s.cardId,source.rules,row.merchantOverride).trim();
      if(!merchant||merchant.length>100||cardRecurringKey(s.cardId,merchant).length>240)continue;
      const key=cardRecurringKey(s.cardId,merchant);
      const group=groups.get(key)??{cardId:s.cardId,merchant,values:[]};
      group.values.push({period,amount:row.amount});groups.set(key,group);
    }
  }
  const results:SubscriptionCandidate[]=[];
  for(const [key,group] of groups){
    // Multiple charges on the same card / merchant / payment month are ambiguous.
    const byMonth=new Map<string,Observation[]>();
    for(const item of group.values){const values=byMonth.get(item.period)??[];values.push(item);byMonth.set(item.period,values);}
    const distinct=[...byMonth.values()].filter(items=>items.length===1).map(items=>items[0]!).sort((a,b)=>a.period.localeCompare(b.period));
    if(distinct.length<2)continue;
    let winner:{frequency:'monthly'|'yearly';values:Observation[]}|null=null;
    // Treat each observed amount as a possible price tier, then pick the most recent substantial pattern.
    for(const anchor of distinct){
      const closeRows=distinct.filter(o=>close(o.amount,anchor.amount));
      const run:Observation[][]=[];let running:Observation[]=[];
      for(const obs of closeRows){
        if(running.length&&periodNumber(obs.period)-periodNumber(running.at(-1)!.period)>1){run.push(running);running=[];}
        running.push(obs);
      }
      if(running.length)run.push(running);
      for(const values of run){
        const recency=periodNumber(asOf)-periodNumber(values.at(-1)!.period);
        if(values.length>=3&&recency<=3&&(!winner||winner.frequency==='yearly'||values.length>winner.values.length||
          (values.length===winner.values.length&&values.at(-1)!.period>winner.values.at(-1)!.period)))
          winner={frequency:'monthly',values};
      }
      // Yearly: two different years, roughly twelve months apart, never inferred from one charge.
      if(!winner){
        for(let i=1;i<closeRows.length;i++){
          const a=closeRows[i-1]!,b=closeRows[i]!;
          if(periodNumber(b.period)-periodNumber(a.period)!==12||periodNumber(asOf)-periodNumber(b.period)>14)continue;
          winner={frequency:'yearly',values:[a,b]};
        }
      }
    }
    if(!winner)continue;
    const {frequency,values}=winner;
    // An already registered bank-side recurring expense is not proposed as a new card charge.
    if(source.assets.recurring.some(item=>item.enabled&&item.kind==='expense'&&item.frequency===frequency&&
      normalizeMerchant(item.name)===normalizeMerchant(group.merchant)&&close(item.amount,median(values.map(v=>v.amount)))))continue;
    const amount=median(values.map(v=>v.amount));
    results.push({key,cardId:group.cardId,cardName:source.assets.cardPreferences?.[group.cardId]?.name??CARDS.find(c=>c.id===group.cardId)?.name??'カード',
      merchant:group.merchant,frequency,amount,minAmount:Math.min(...values.map(v=>v.amount)),maxAmount:Math.max(...values.map(v=>v.amount)),
      months:values.map(v=>v.period),confidence:frequency==='monthly'&&values.length>=4?'high':'medium'});
  }
  return results.sort((a,b)=>b.months.at(-1)!.localeCompare(a.months.at(-1)!)||b.months.length-a.months.length||a.merchant.localeCompare(b.merchant,'ja'));
}
export function pendingCardSubscriptions(source:MonthlySource,asOf?:string):SubscriptionCandidate[]{
  const decisions=source.assets.cardRecurringDecisions??{};
  return detectCardSubscriptions(source,asOf).filter(candidate=>!decisions[candidate.key]);
}
export function subscriptionDecision(candidate:SubscriptionCandidate,state:CardRecurringDecision['state'],now=new Date().toISOString()):CardRecurringDecision {
  return {cardId:candidate.cardId,merchant:normalizeMerchant(candidate.merchant),label:candidate.merchant,amount:candidate.amount,
    frequency:candidate.frequency,state,updatedAt:now};
}
