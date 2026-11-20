export type Provider = 'rakuten' | 'jcb' | 'view' | 'smbc' | 'goldpoint' | 'unknown';
export type SourceKind = 'pdf' | 'paste' | 'csv';
export type ConfirmationState = 'confirmed' | 'provisional' | 'unknown';

export interface CardDefinition {
  id: string;
  name: string;
  provider: Exclude<Provider, 'unknown'>;
}

export const CARDS: readonly CardDefinition[] = [
  { id: 'rakuten-mizuho', name: 'みずほ楽天カード', provider: 'rakuten' },
  { id: 'rakuten-etc', name: '楽天カード', provider: 'rakuten' },
  { id: 'recruit-jcb', name: 'リクルートカード（JCB）', provider: 'jcb' },
  { id: 'bic-suica', name: 'ビックカメラSuicaカード', provider: 'view' },
  { id: 'smbc-nl', name: '三井住友カード NL', provider: 'smbc' },
  { id: 'amazon', name: 'Amazonカード', provider: 'smbc' },
  { id: 'goldpoint', name: 'GOLD POINT CARD+', provider: 'goldpoint' },
] as const;

export interface ImportRow {
  id: string;
  usedOn: string;  // YYYY-MM-DD
  merchant: string; // Card issuer's original name; never modified by display rules.
  merchantOverride?: string; // Optional display name for this row only.
  amount: number;  // Charged amount for this billing month, signed JPY.
  description?: string;
  sourceLine?: number;
}

export interface ParsedStatement {
  provider: Provider;
  cardId: string | null;
  sourceKind: SourceKind;
  sourceName: string;
  billingMonth: string | null; // YYYY-MM
  paymentDate: string | null;  // YYYY-MM-DD
  statedTotal: number | null;
  confirmation: ConfirmationState;
  rows: ImportRow[];
  warnings: string[];
}

export function getCard(id: string | null): CardDefinition | undefined {
  return CARDS.find(card => card.id === id);
}

export function calculatedTotal(statement: ParsedStatement): number {
  return statement.rows.reduce((sum, row) => sum + row.amount, 0);
}
