export function prioritizedIndices(items, priority) {
    return items.map((_, index) => index).sort((a, b) => {
        const diff = priority(items[a]) - priority(items[b]);
        return diff || a - b;
    });
}
export function orderedPreviewRows(rows, sort) {
    if (!sort)
        return [...rows];
    const factor = sort.direction === 'asc' ? 1 : -1;
    return rows.map((row, index) => ({ row, index })).sort((a, b) => {
        const diff = sort.key === 'usedOn'
            ? a.row.usedOn.localeCompare(b.row.usedOn)
            : a.row.amount - b.row.amount;
        return factor * Math.sign(diff) || a.index - b.index;
    }).map(({ row }) => row);
}
