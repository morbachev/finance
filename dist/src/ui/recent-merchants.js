import { normalizeMerchant } from '../cloud/merchant-rules.js';
/** Historical raw issuer names only, never aliased display names. */
export function recentMerchants(statements) {
    const names = new Map();
    for (const statement of statements)
        for (const row of statement.rows) {
            const merchant = row.merchant.trim();
            if (!merchant)
                continue;
            const key = `${statement.cardId ?? 'unknown'}\u0000${normalizeMerchant(merchant)}`;
            const date = /^\d{4}-\d{2}-\d{2}$/.test(row.usedOn) ? row.usedOn : (statement.billingMonth ?? '');
            const previous = names.get(key);
            if (previous) {
                previous.count++;
                if (date > previous.lastDate) {
                    previous.merchant = merchant;
                    previous.lastDate = date;
                }
            }
            else
                names.set(key, { merchant, cardId: statement.cardId ?? 'unknown', lastDate: date, count: 1 });
        }
    return [...names.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.count - a.count || a.merchant.localeCompare(b.merchant, 'ja'));
}
