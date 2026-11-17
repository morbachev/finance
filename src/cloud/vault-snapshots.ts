/** Immutable encrypted vault snapshots. Never replaces or removes an existing cloud file. */

export const SNAPSHOT_PREFIX = 'finance-vault-';
export const SNAPSHOT_SUFFIX = '.enc.json';
export const MAX_SNAPSHOT_BYTES = 150 * 1024 * 1024;

export interface VaultSnapshot {
  id: string;
  name: string;
  size: number;
  createdDateTime: string;
}

export function snapshotName(now: Date, id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('スナップショット識別子が不正です。');
  return `${SNAPSHOT_PREFIX}${now.toISOString().replace(/[:.]/g, '-')}-${id}${SNAPSHOT_SUFFIX}`;
}

export function isSnapshotName(name: string): boolean {
  return /^finance-vault-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.enc\.json$/i.test(name);
}

export function asSnapshots(items: unknown): VaultSnapshot[] {
  if (!Array.isArray(items)) throw new Error('OneDriveの一覧形式が不正です。');
  return items.filter((item): item is VaultSnapshot => {
    if (!item || typeof item !== 'object') return false;
    const v = item as Record<string, unknown>;
    return typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 300 &&
      typeof v.name === 'string' && isSnapshotName(v.name) &&
      typeof v.size === 'number' && Number.isSafeInteger(v.size) && v.size > 0 && v.size <= MAX_SNAPSHOT_BYTES &&
      typeof v.createdDateTime === 'string' && Number.isFinite(Date.parse(v.createdDateTime));
  }).sort((a, b) => b.createdDateTime.localeCompare(a.createdDateTime) || b.name.localeCompare(a.name));
}

export function validateBackupText(text: string): void {
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('バックアップが150MBを超えています。');
  let data: {format?: unknown; meta?: unknown; records?: unknown};
  try { data = JSON.parse(text) as typeof data; }
  catch { throw new Error('暗号化バックアップのJSONが不正です。'); }
  if (data?.format !== 'finance-encrypted-backup-v1' || !data.meta || !Array.isArray(data.records)) {
    throw new Error('Financeの暗号化バックアップではありません。');
  }
}
