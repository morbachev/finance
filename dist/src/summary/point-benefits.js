/** Card-by-card points from validated saved statements, assigned by payment month. */
import { CARDS } from '../models/types.js';
import { monthlyReport } from './monthly-summary.js';
// Default rates can be overridden for each card in Settings.
export const DEFAULT_POINT_RATES = {
    'rakuten-mizuho': 2, 'rakuten-etc': 1, 'recruit-jcb': 1.2,
    'bic-suica': 0.5, 'smbc-nl': 0.5, 'amazon': 1, 'goldpoint': 1,
};
export function pointRate(cardId, preferences) {
    const configured = preferences?.[cardId]?.pointRatePercent;
    return configured !== undefined ? configured : DEFAULT_POINT_RATES[cardId] ?? 0;
}
export function pointsForAmount(amount, ratePercent) {
    if (!Number.isSafeInteger(amount) || !Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100)
        throw new Error('ポイント計算に不正な数値があります。');
    return Math.max(0, Math.floor(amount * ratePercent / 100));
}
export function statementPoints(statement, preferences) {
    if (!statement.cardId)
        return 0;
    return pointsForAmount(statement.rows.reduce((sum, row) => sum + row.amount, 0), pointRate(statement.cardId, preferences));
}
export function pointBenefitsFromCards(cards, preferences) {
    const byCard = new Map();
    for (const card of cards) {
        const prev = byCard.get(card.cardId);
        const ratePercent = pointRate(card.cardId, preferences);
        const amount = (prev?.amount ?? 0) + card.amount;
        if (!Number.isSafeInteger(amount))
            throw new Error('カードの請求金額が大きすぎます。');
        byCard.set(card.cardId, { cardId: card.cardId, name: preferences?.[card.cardId]?.name ?? CARDS.find(c => c.id === card.cardId)?.name ?? card.name,
            amount, ratePercent, points: 0 });
    }
    const items = [...byCard.values()].map(card => ({ ...card, points: pointsForAmount(card.amount, card.ratePercent) }));
    items.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'ja'));
    return { total: items.reduce((sum, c) => sum + c.points, 0), cards: items };
}
export function monthlyPointBenefits(period, source) {
    return pointBenefitsFromCards(monthlyReport(period, source).cardLines, source.assets.cardPreferences);
}
export function periodPointBenefits(periods, source) {
    const sums = new Map();
    let total = 0;
    for (const period of periods) {
        const month = monthlyPointBenefits(period, source);
        total += month.total;
        for (const card of month.cards) {
            const old = sums.get(card.cardId);
            sums.set(card.cardId, { ...card, amount: (old?.amount ?? 0) + card.amount, points: (old?.points ?? 0) + card.points });
        }
    }
    return { total, cards: [...sums.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'ja')) };
}
