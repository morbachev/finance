import type { ImportRow, ParsedStatement, Provider, SourceKind } from '../models/types.js';
import { classifyStatus, findAmountFollowing, isoDate, lineList, matchPaymentDate, normalize, parseYen, paymentMonth, rowId, squish } from './utils.js';

export function detectProvider(raw: string): Provider {
  const n = normalize(raw).toUpperCase();
  if (n.includes('楽天カード株式会社') || n.includes('楽天カード(VISA)')) return 'rakuten';
  if (n.includes('ビックカメラSUICAカード') || n.includes('ビューカード')) return 'view';
  if (n.includes('GOLD POINT CARD') || n.includes('ゴールドポイントマーケティング') || n.includes('ゴールドポイントカードプラス')) return 'goldpoint';
  if (n.includes('SMBC-CARD.COM') || n.includes('三井住友カード') || n.includes('WEB明細書') && n.includes('支払予定月')) return 'smbc';
  if (n.includes('株式会社ジェーシービー') || n.includes('リクルートカード') || n.includes('MYJCB')) return 'jcb';
  return 'unknown';
}

function addRow(rows: ImportRow[], date: string | null, merchant: string, amount: number | null, sourceLine: number, description?: string): void {
  if (!date || amount === null || !merchant.trim()) return;
  rows.push({ id: rowId(rows.length), usedOn: date, merchant: squish(merchant), amount, sourceLine, ...(description ? { description: squish(description) } : {}) });
}

function parseRakuten(text: string, rows: ImportRow[]): { cardId: string | null; paymentDate: string | null; statedTotal: number | null; billingMonth: string | null } {
  const n = normalize(text);
  const lines = lineList(n);
  const billHeaderIndex = lines.findIndex(line => /(20\d{2})年(\d{1,2})月ご請求金額/.test(line));
  const billHeader = billHeaderIndex >= 0 ? lines[billHeaderIndex]! : '';
  const billMatch = /(20\d{2})年(\d{1,2})月ご請求金額/.exec(billHeader);
  const billingMonth = billMatch ? `${billMatch[1]}-${String(Number(billMatch[2])).padStart(2, '0')}` : null;
  const totalLine = billHeaderIndex >= 0 ? lines.slice(billHeaderIndex + 1, billHeaderIndex + 6).find(line => /^([\d,]+)円(?:\s|$)/.test(line)) : undefined;
  const total = parseYen(/^([\d,]+)円/.exec(totalLine ?? '')?.[1]);
  const paymentHeaderIndex = lines.findIndex(line => /お支払日\s+返済方法/.test(line));
  const paymentLine = paymentHeaderIndex >= 0 ? lines[paymentHeaderIndex + 1] ?? '' : '';
  const dateMatch = /^(20\d{2})\/(\d{1,2})\/(\d{1,2})/.exec(paymentLine);
  const date = dateMatch ? isoDate(+dateMatch[1]!, +dateMatch[2]!, +dateMatch[3]!) : matchPaymentDate(n);
  let previous: ImportRow | undefined;
  let inItems = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^利用日\s+利用店名/.test(line)) { inItems = true; continue; }
    if (/請求金額確定前の明細|リボのお支払予定|お支払予定表|^※/.test(line) && inItems) { inItems = false; }
    if (!inItems) continue;
    const m = /^(20\d{2})\/(\d{1,2})\/(\d{1,2})\s+(.+?)\s+(本人|ETC)\*?\s+(?:\d+回払い|リボ払い|分割払い|ボーナス払い)\s+(.+)$/.exec(line);
    if (m) {
      const digits = [...m[6]!.matchAll(/[-−]?\d[\d,]*/g)].map(x => parseYen(x[0])).filter((n): n is number => n !== null);
      // Rakuten's last amount is the carried balance; penultimate is "当月請求額".
      const amount = digits.length >= 2 ? digits[digits.length - 2]! : null;
      addRow(rows, isoDate(+m[1]!, +m[2]!, +m[3]!), m[4]!, amount, i + 1);
      previous = rows.at(-1);
    } else if (previous && /ETCカード売上/.test(previous.merchant) && /^[\p{L}\p{N}\s\/\-ー]{3,}$/u.test(line) && !/利用|残高|請求|金額/.test(line)) {
      previous.description = line; // ETC toll road / segment notes on next line.
    }
  }
  // Detect card type from the actual transaction description, without embedding
  // card-number fragments in a potentially public static app.
  const allEtc = rows.length > 0 && rows.every(row => /ETCカード売上/.test(row.merchant));
  const noEtc = rows.length > 0 && rows.every(row => !/ETCカード売上/.test(row.merchant));
  const cardId = allEtc ? 'rakuten-etc' : noEtc ? 'rakuten-mizuho' : null;
  return { cardId, paymentDate: date, statedTotal: total, billingMonth: billingMonth ?? paymentMonth(date) };
}

function parseJcb(text: string, rows: ImportRow[]) {
  const n = normalize(text);
  const lines = lineList(n);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(20\d{2})\/(\d{1,2})\/(\d{1,2})\s+(.+?)\s+([-−]?[\d,]+)\s+(?:\d+回|リボ|ボ\d+|C\d+|S\d+)\s+([-−]?[\d,]+)/.exec(lines[i]!);
    if (!m) continue;
    addRow(rows, isoDate(+m[1]!, +m[2]!, +m[3]!), m[4]!, parseYen(m[6]!), i + 1);
  }
  const total = findAmountFollowing(n, /◆今回のお支払金額総合計\s*([\d,]+)/);
  const date = matchPaymentDate(n);
  return { cardId: 'recruit-jcb', paymentDate: date, billingMonth: paymentMonth(date), statedTotal: total };
}

function parseView(text: string, rows: ImportRow[]) {
  const n = normalize(text);
  const lines = lineList(n);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d{2})\s+(\d{2})\s+(\d{2})\s+[★●■\s]*(.+?)\s+([-−]?[\d,]+)\s+([-−]?[\d,]+)\s+(?:\d+回払|リボ払|ボーナス).*?([-−]?[\d,]+)\s*$/.exec(lines[i]!);
    if (!m) continue;
    addRow(rows, isoDate(+m[1]!, +m[2]!, +m[3]!), m[4]!, parseYen(m[7]!), i + 1);
  }
  const date = matchPaymentDate(n);
  const total = findAmountFollowing(n, /ご請求額合計\s*([\d,]+)/) ?? findAmountFollowing(n, /お支払額\s*([\d,]+)円?/);
  return { cardId: 'bic-suica', paymentDate: date, billingMonth: paymentMonth(date), statedTotal: total };
}

function parseSmbc(text: string, rows: ImportRow[], candidateRows: string[][]) {
  const n = normalize(text);
  const date = matchPaymentDate(n);
  const metadata = n.replace(/\|/g, ' ').replace(/\*\*/g, '');
  const total = findAmountFollowing(metadata, /(?:ご利用明細合計|ご請求金額合計)\s*([\d,]+)円?/)
    ?? findAmountFollowing(metadata, /支払い予定分のご利用明細合計\s*([\d,]+)円?/);
  const rowSources = candidateRows.length ? candidateRows : lineList(n).map(row => splitRow(row));
  for (let i = 0; i < rowSources.length; i++) {
    const cells = rowSources[i]!.map(squish).filter(Boolean);
    const di = cells.findIndex(cell => /^\d{2}\/\d{2}\/\d{2}$/.test(cell));
    if (di !== -1 && cells[di + 1]) {
      const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(cells[di]!);
      const merchant = cells[di + 1]!;
      const monthIdx = cells.findIndex((v, index) => index > di + 1 && /^\d{2}\/\d{2}$/.test(v));
      const amountIdx = monthIdx >= 0 ? monthIdx + 1 : cells.findIndex((v, index) => index > di + 1 && /^-?[\d,]+$/.test(v));
      if (match && amountIdx >= 0) addRow(rows, isoDate(+match[1]!, +match[2]!, +match[3]!), merchant, parseYen(cells[amountIdx]), i + 1);
      continue;
    }
    const flat = cells.join(' ');
    const m = /^(\d{2})\/(\d{2})\/(\d{2})\s+(.+?)\s+(?:ご本人|本人)\s+(?:\d+回払い|リボ払い|分割払い)\s+(?:(?:\d{2}\/\d{2})\s+)?([-−]?[\d,]+)(?:\s|$)/.exec(flat);
    if (m) addRow(rows, isoDate(+m[1]!, +m[2]!, +m[3]!), m[4]!, parseYen(m[5]!), i + 1);
  }
  // In this personal workflow, Amazon purchases in the statement identify the
  // Amazon-branded card; otherwise the Vpass statement is the NL card.
  // The card selector remains editable if this heuristic ever misidentifies one.
  const amazonStatement = rows.some(row => /AMAZON|アマゾン/i.test(normalize(row.merchant)));
  const cardId = rows.length ? (amazonStatement ? 'amazon' : 'smbc-nl') : null;
  return { cardId, paymentDate: date, billingMonth: paymentMonth(date), statedTotal: total };
}

function parseGold(text: string, rows: ImportRow[], candidateRows: string[][]) {
  const n = normalize(text);
  const date = matchPaymentDate(n);
  const metadata = n.replace(/\|/g, ' ').replace(/\*\*/g, '');
  const total = findAmountFollowing(metadata, /お支払い合計額\s*([\d,]+)円?/)
    ?? findAmountFollowing(metadata, /お支払金額総合計[^\d]*([\d,]+)/);
  const rowSources = candidateRows.length ? candidateRows : lineList(n).map(splitRow);
  for (let i = 0; i < rowSources.length; i++) {
    const cells = rowSources[i]!.map(squish).filter(Boolean);
    const di = cells.findIndex(v => /^\d{2}\/\d{2}\/\d{2}$/.test(v));
    if (di >= 0 && cells[di + 1] && cells[di + 2]) {
      const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(cells[di]!);
      if (m) addRow(rows, isoDate(+m[1]!, +m[2]!, +m[3]!), cells[di + 1]!, parseYen(cells[di + 2]), i + 1);
      continue;
    }
    const flat = cells.join(' ');
    const m = /^(\d{2})\/(\d{2})\/(\d{2})\s+(.+?)\s+([\d,]+)\s+(?:1|2|\d+|リボ)/.exec(flat);
    if (m) addRow(rows, isoDate(+m[1]!, +m[2]!, +m[3]!), m[4]!, parseYen(m[5]!), i + 1);
  }
  return { cardId: 'goldpoint', paymentDate: date, billingMonth: paymentMonth(date), statedTotal: total };
}

function splitRow(row: string): string[] {
  // Markdown tables, TSV browser clipboard and PDF.js reconstructed lines.
  if (row.includes('|')) return row.split('|').map(x => x.trim()).filter(Boolean);
  if (row.includes('\t')) return row.split('\t').map(x => x.trim()).filter(Boolean);
  return [squish(row)];
}

/** Extracts table cells from pasted HTML without injecting any HTML into the page. */
export function clipboardRowsFromHtml(html: string): string[][] {
  if (!html || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('table tr')].map(tr => [...tr.children]
    .filter(cell => cell.matches('td,th'))
    .map(cell => squish(cell.textContent ?? ''))).filter(cells => cells.length > 0);
}

export function parseStatementText(raw: string, sourceKind: SourceKind, sourceName: string, html = ''): ParsedStatement {
  const normalized = normalize(raw);
  const htmlRows = clipboardRowsFromHtml(html);
  const rowsCandidate = htmlRows.length ? htmlRows : lineList(normalized).map(splitRow);
  // Include HTML table text in provider / metadata detection when text/plain is minimal.
  const detectionText = normalized + '\n' + htmlRows.map(row => row.join(' ')).join('\n');
  const provider = detectProvider(detectionText);
  const rows: ImportRow[] = [];
  const warnings: string[] = [];
  let data: { cardId: string | null; paymentDate: string | null; statedTotal: number | null; billingMonth: string | null };
  switch (provider) {
    case 'rakuten': data = parseRakuten(normalized, rows); break;
    case 'jcb': data = parseJcb(normalized, rows); break;
    case 'view': data = parseView(normalized, rows); break;
    case 'smbc': data = parseSmbc(normalized, rows, rowsCandidate); break;
    case 'goldpoint': data = parseGold(normalized, rows, rowsCandidate); break;
    default: data = { cardId: null, paymentDate: null, statedTotal: null, billingMonth: null };
  }
  if (provider === 'unknown') warnings.push('カード会社の明細形式を特定できませんでした。対応形式か確認してください。');
  if (provider === 'smbc' && data.cardId) warnings.push('Vpassのカード名は利用先から推定しました。別のカードの場合はカード欄で変更してください。');
  if (provider === 'rakuten' && !data.cardId) warnings.push('楽天カードの種類を特定できませんでした。対象カードを選択してください。');
  if (rows.length === 0) warnings.push(sourceKind === 'pdf' ? '明細の行を抽出できませんでした。画像化されたPDFの場合はWeb明細のコピーを貼り付けてください。' : '取引行を抽出できませんでした。Web画面の表全体をコピーして貼り付けてください。');
  if (!data.billingMonth) warnings.push('請求月を特定できませんでした。');
  if (data.statedTotal === null) warnings.push('請求総額を特定できませんでした。');
  const sum = rows.reduce((s, row) => s + row.amount, 0);
  if (rows.length && data.statedTotal !== null && sum !== data.statedTotal) warnings.push(`請求金額と明細合計に差額があります（${(data.statedTotal - sum).toLocaleString('ja-JP')}円）。内容を確認してください。`);
  return { provider, cardId: data.cardId, sourceKind, sourceName, billingMonth: data.billingMonth,
    paymentDate: data.paymentDate, statedTotal: data.statedTotal, confirmation: classifyStatus(normalized), rows, warnings };
}
