/** Card-by-card points from validated saved statements, assigned by payment month. */
import { CARDS, type ParsedStatement } from '../models/types.js';
import { monthlyReport, type MonthlySource, type SummaryCard } from './monthly-summary.js';
import type { CardPreference } from '../cloud/assets.js';

// Default rates can be overridden for each card in Settings.
export const DEFAULT_POINT_RATES:Readonly<Record<string,number>>={
  'rakuten-mizuho':2, 'rakuten-etc':1, 'recruit-jcb':1.2,
  'bic-suica':0.5, 'smbc-nl':0.5, 'amazon':1, 'goldpoint':1,
};
export interface CardPointBenefit {cardId:string;name:string;amount:number;ratePercent:number;points:number}
export interface PointBenefits {total:number;cards:CardPointBenefit[]}
export function pointRate(cardId:string,preferences?:Record<string,CardPreference>):number {
  const configured=preferences?.[cardId]?.pointRatePercent;
  return configured!==undefined?configured:DEFAULT_POINT_RATES[cardId]??0;
}
export function pointsForAmount(amount:number,ratePercent:number):number {
  if(!Number.isSafeInteger(amount)||!Number.isFinite(ratePercent)||ratePercent<0||ratePercent>100)throw new Error('ポイント計算に不正な数値があります。');
  return Math.max(0,Math.floor(amount*ratePercent/100));
}
export function statementPoints(statement:Pick<ParsedStatement,'cardId'|'rows'>,preferences?:Record<string,CardPreference>):number {
  if(!statement.cardId)return 0;
  return pointsForAmount(statement.rows.reduce((sum,row)=>sum+row.amount,0),pointRate(statement.cardId,preferences));
}
export function pointBenefitsFromCards(cards:readonly SummaryCard[],preferences?:Record<string,CardPreference>):PointBenefits {
  const byCard=new Map<string,CardPointBenefit>();
  for(const card of cards){
    const prev=byCard.get(card.cardId);
    const ratePercent=pointRate(card.cardId,preferences);
    const amount=(prev?.amount??0)+card.amount;
    if(!Number.isSafeInteger(amount))throw new Error('カードの請求金額が大きすぎます。');
    byCard.set(card.cardId,{cardId:card.cardId,name:preferences?.[card.cardId]?.name??CARDS.find(c=>c.id===card.cardId)?.name??card.name,
      amount,ratePercent,points:0});
  }
  const items=[...byCard.values()].map(card=>({...card,points:pointsForAmount(card.amount,card.ratePercent)}));
  items.sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name,'ja'));
  return {total:items.reduce((sum,c)=>sum+c.points,0),cards:items};
}
export function monthlyPointBenefits(period:string,source:MonthlySource):PointBenefits {
  return pointBenefitsFromCards(monthlyReport(period,source).cardLines,source.assets.cardPreferences);
}
export function periodPointBenefits(periods:readonly string[],source:MonthlySource):PointBenefits {
  const sums=new Map<string,CardPointBenefit>();let total=0;
  for(const period of periods){
    const month=monthlyPointBenefits(period,source);total+=month.total;
    for(const card of month.cards){
      const old=sums.get(card.cardId);
      sums.set(card.cardId,{...card,amount:(old?.amount??0)+card.amount,points:(old?.points??0)+card.points});
    }
  }
  return {total,cards:[...sums.values()].sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name,'ja'))};
}
