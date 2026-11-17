import { CARDS, calculatedTotal, type ParsedStatement } from '../models/types.js';

function realDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function importErrors(statement: ParsedStatement, hasPdf: boolean): string[] {
  const issues: string[] = [];
  if (!CARDS.some(c => c.id === statement.cardId && c.provider === statement.provider)) issues.push('カード種別が不明です');
  if (!statement.billingMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(statement.billingMonth)) issues.push('請求月が不正です');
  if (!statement.paymentDate || !realDate(statement.paymentDate)) issues.push('支払日が不明または不正です');
  if (statement.statedTotal === null || !Number.isSafeInteger(statement.statedTotal)) issues.push('請求総額が不正です');
  if (!statement.rows.length) issues.push('取引がありません');
  if (statement.rows.some(row => !realDate(row.usedOn) || !row.merchant.trim() || !Number.isSafeInteger(row.amount))) issues.push('利用日・利用先・金額に不備があります');
  if (statement.statedTotal !== null && calculatedTotal(statement) !== statement.statedTotal) issues.push('請求総額と明細合計が一致しません');
  if (statement.sourceKind === 'pdf' && !hasPdf) issues.push('PDF原本がありません');
  return issues;
}

export function duplicateMonths(statements: ParsedStatement[]): Set<number> {
  const seen = new Map<string, number>();
  const conflicts = new Set<number>();
  for (const [index, statement] of statements.entries()) {
    if (!statement.cardId || !statement.billingMonth) continue;
    const key = `${statement.cardId}|${statement.billingMonth}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, index);
    else { conflicts.add(first); conflicts.add(index); }
  }
  return conflicts;
}
