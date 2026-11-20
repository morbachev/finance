/** Home uses the unchanged monthlyReport as its only household cashflow source. */
import { latestBalance, type AssetAccountId, type BalanceSnapshot } from '../cloud/assets.js';
import { monthlyReport, type MonthlyReport, type MonthlySource } from '../summary/monthly-summary.js';
import { forecastAccounts, type AccountForecasts } from './account-events.js';
import { homeActions, type HomeAction } from './action-items.js';
import {pendingCardSubscriptions} from '../subscriptions/detect.js';
export type HomeCoverage='missing'|'needs-review'|'provisional'|'registered';
export interface HomeAccount {
  id:AssetAccountId; name:string; snapshot:BalanceSnapshot|null;
  predicted:number|null; predictedReliable:boolean; projectedAt:string|null;
}
export interface HomeOverview {
  today:string; period:string; report:MonthlyReport; coverage:HomeCoverage;
  outflow:number|null; cardNames:Record<string,string>; accounts:HomeAccount[]; forecast:AccountForecasts; actions:HomeAction[];
}
export function homeOverview(source:MonthlySource,today:string):HomeOverview {
  const report=monthlyReport(today.slice(0,7),{...source,currentPeriod:today.slice(0,7)});
  const forecast=forecastAccounts(source,today);
  const coverage:HomeCoverage=report.cardLines.length===0?'missing':report.issues.length||report.unknownConfirmationCount?'needs-review':
    report.provisional.length?'provisional':'registered';
  const outflow=report.cardOutflow===null?null:report.cardOutflow+report.recurringExpense+report.oneTimeExpense;
  if(outflow!==null&&!Number.isSafeInteger(outflow))throw new Error('ホームの支出額が大きすぎます。');
  const bankAccountIds:AssetAccountId[]=['rakuten-bank','mizuho-bank','cash-savings','nisa'];
  const labels:Record<AssetAccountId,string>={'rakuten-bank':'楽天銀行','mizuho-bank':'みずほ銀行',
    'cash-savings':'貯金口座','nisa':'NISA'};
  const accounts=bankAccountIds.map(id=>{
    const snapshot=source.assets.snapshots?.filter(s=>s.accountId===id&&
      new Date(s.observedAt).getTime()<=new Date(`${today}T23:59:59Z`).getTime())
      .sort((a,b)=>b.observedAt.localeCompare(a.observedAt))[0]??null;
    const bank=forecast.accounts.find(item=>item.accountId===id);
    return {id,name:labels[id],snapshot,predicted:bank?.projected??null,
      predictedReliable:bank?.reliable??false,projectedAt:bank?.projectedAt??null};
  });
  const cardNames=Object.fromEntries(Object.entries(source.assets.cardPreferences??{}).filter(([,preference])=>!!preference.name).map(([id,preference])=>[id,preference.name!]));
  const actions=homeActions(source,report,forecast,today);
  const candidates=pendingCardSubscriptions(source,today.slice(0,7));
  if(candidates.length)actions.push({id:'card-subscription-candidates',kind:'subscription',severity:'low',
    title:`定期支出の候補が${candidates.length}件あります`,target:'subscriptions'});
  return {today,period:report.period,report,coverage,outflow,cardNames,accounts,forecast,actions};
}
