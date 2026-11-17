/**
 * Pure display-order utilities. Never mutate statements or transaction rows:
 * draft identity, deletion indices, source fingerprints, and batch imports must
 * all continue to refer to the original underlying objects.
 */
export type PreviewSort = {
  key: 'usedOn' | 'amount';
  direction: 'asc' | 'desc';
};

export function prioritizedIndices<T>(items: readonly T[], priority: (item: T) => number): number[] {
  return items.map((_, index) => index).sort((a, b) => {
    const diff = priority(items[a]!) - priority(items[b]!);
    return diff || a - b;
  });
}

export function orderedPreviewRows<T extends { usedOn: string; amount: number }>(
  rows: readonly T[],
  sort: PreviewSort | null,
): T[] {
  if (!sort) return [...rows];
  const factor = sort.direction === 'asc' ? 1 : -1;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const diff = sort.key === 'usedOn'
      ? a.row.usedOn.localeCompare(b.row.usedOn)
      : a.row.amount - b.row.amount;
    return factor * Math.sign(diff) || a.index - b.index;
  }).map(({ row }) => row);
}
