/** Modal-only category edits. Nothing is written until the whole draft is committed. */
import { validateCategory, type CategoryDefinition, type CategoryId } from '../cloud/merchant-rules.js';

export interface CategoryBatch {
  upserts: CategoryDefinition[];
  removeIds: CategoryId[];
}

export function planCategoryBatch(before: readonly CategoryDefinition[], after: readonly CategoryDefinition[]): CategoryBatch {
  if (after.length > 160) throw new Error('カテゴリーは160件以内にしてください。');
  const oldById = new Map(before.map(item => [item.id, item]));
  const present = new Set<string>();
  const names = new Set<string>();
  const upserts: CategoryDefinition[] = [];
  for (const raw of after) {
    const category = validateCategory(raw);
    if (present.has(category.id)) throw new Error('カテゴリーIDが重複しています。');
    present.add(category.id);
    const key = category.name.normalize('NFKC').toLocaleLowerCase();
    if (names.has(key)) throw new Error(`「${category.name}」と同じ名前のカテゴリーがあります。`);
    names.add(key);
    const old = oldById.get(category.id);
    if (!old || old.name !== category.name || old.color !== category.color) upserts.push(category);
  }
  const removeIds = before.filter(item => !present.has(item.id)).map(item => item.id);
  return { upserts, removeIds };
}

export function categoryBatchChanged(batch: CategoryBatch): boolean {
  return batch.upserts.length > 0 || batch.removeIds.length > 0;
}
