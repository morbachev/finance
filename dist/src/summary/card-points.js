export function estimateCardPoints(records, cardId, ratePercent) {
    let sumYen = 0, rows = 0, statements = 0, provisional = 0;
    for (const { statement } of records) {
        if (statement.cardId !== cardId)
            continue;
        statements++;
        if (statement.confirmation === 'provisional')
            provisional++;
        for (const row of statement.rows) {
            if (!Number.isSafeInteger(row.amount))
                continue;
            sumYen += row.amount;
            rows++;
        }
    }
    // Round only the final estimate; real provider point rules can differ per transaction.
    const points = ratePercent === undefined ? null : Math.max(0, Math.floor(sumYen * ratePercent / 100));
    return { sumYen, rows, statements, points, provisional };
}
