import { normalize, squish } from './utils.js';
function identity(row) {
    return JSON.stringify([row.usedOn, squish(row.merchant).toUpperCase(), row.amount]);
}
function rowDescription(row) { return normalize(row.description ?? '').trim(); }
/** Never trust row-1/row-2 identifiers when switching between pasted tables and CSVs. */
export function prepareStatementRevision(existing, incoming) {
    const next = structuredClone(incoming);
    const before = new Map(), after = new Map();
    for (const r of existing.rows) {
        const key = identity(r);
        before.set(key, [...(before.get(key) ?? []), r]);
    }
    for (const r of next.rows) {
        const key = identity(r);
        after.set(key, [...(after.get(key) ?? []), r]);
    }
    const diff = { matched: 0, added: [], removed: [], changed: [], ambiguous: [], transferred: 0, notesTransferred: 0, overridesLost: [] };
    for (const key of new Set([...before.keys(), ...after.keys()])) {
        const old = before.get(key) ?? [], fresh = after.get(key) ?? [];
        if (old.length !== 1 || fresh.length !== 1) {
            // Repeated identical purchases cannot safely inherit per-row edits.
            diff.ambiguous.push(...fresh);
            if (old.length === 0)
                diff.added.push(...fresh);
            else if (fresh.length === 0)
                diff.removed.push(...old);
            else {
                if (fresh.length > old.length)
                    diff.added.push(...fresh.slice(old.length));
                if (old.length > fresh.length)
                    diff.removed.push(...old.slice(fresh.length));
            }
            diff.overridesLost.push(...old.filter(x => !!x.merchantOverride || !!x.description));
            continue;
        }
        const previous = old[0], current = fresh[0];
        diff.matched++;
        if (previous.merchantOverride) {
            current.merchantOverride = previous.merchantOverride;
            diff.transferred++;
        }
        if (previous.description && !current.description) {
            current.description = previous.description;
            diff.notesTransferred++;
        }
        else if (rowDescription(previous) !== rowDescription(current)) {
            diff.changed.push({ before: previous, after: current });
            if (previous.description)
                diff.overridesLost.push(previous);
        }
    }
    return { statement: next, diff };
}
