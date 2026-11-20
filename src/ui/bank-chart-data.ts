/** Read-only point projection for the Rakuten Bank chart.
 * The timeline itself remains the sole calculation of day-end balances. */
import type { BankEvent, BankTimeline } from '../summary/bank-timeline.js';

export type BankChartPointKind = 'opening' | 'event' | 'month-end';
export interface BankChartPoint {
  date: string;
  day: number;
  balance: number;
  delta: number;
  items: BankEvent[];
  kind: BankChartPointKind;
}
export interface BankChartData { series: BankChartPoint[]; selectable: BankChartPoint[]; lastDay: number }

export function bankChartData(timeline: BankTimeline, period: string): BankChartData | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || timeline.startBalance === null || !timeline.startDay) return null;
  const year = Number(period.slice(0, 4)), month = Number(period.slice(5));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = `${period}-01`, end = `${period}-${String(lastDay).padStart(2, '0')}`;
  if (timeline.startDay > end) return null;

  let opening = timeline.startBalance;
  for (const day of timeline.days) if (day.date < first) opening = day.balance;
  const openDate = timeline.startDay > first ? timeline.startDay : first;
  const series: BankChartPoint[] = [{date:openDate, day:Number(openDate.slice(8)), balance:opening, delta:0, items:[], kind:'opening'}];
  for (const day of timeline.days) {
    if (day.date >= first && day.date <= end && day.date > timeline.startDay) {
      series.push({date:day.date,day:Number(day.date.slice(8)),balance:day.balance,delta:day.delta,items:day.items,kind:'event'});
    }
  }
  const last = series[series.length - 1]!;
  if (last.day < lastDay) series.push({date:end,day:lastDay,balance:last.balance,delta:0,items:[],kind:'month-end'});
  // A first-of-month transaction and the opening balance share an x-coordinate.
  // Keep the opening point in the drawn path, but expose only the day-end event for selection.
  const unique = new Map<string, BankChartPoint>();
  for (const point of series) unique.set(point.date, point);
  return {series,selectable:[...unique.values()],lastDay};
}
