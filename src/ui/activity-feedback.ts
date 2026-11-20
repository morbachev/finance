/** Finance-wide, ephemeral feedback. No financial information is persisted here. */
export type ActivityKind = 'working' | 'good' | 'warn' | 'bad' | 'info';
let dismissal: ReturnType<typeof setTimeout> | undefined;
let previousMessage = '';
let previousKind: ActivityKind | '' = '';
let previousAt = 0;

export function showActivity(message: string, kind: ActivityKind = 'info'): void {
  const value = message.trim();
  if (!value) return;
  const panel = document.getElementById('toast');
  const label = panel?.querySelector<HTMLElement>('.activity-message');
  if (!panel || !label) return;
  const now = Date.now();
  // Some legacy callers issue a successful operationResult and a toast together.
  if (kind === previousKind && now - previousAt < 450 && (value === previousMessage || kind === 'good')) return;
  previousMessage = value; previousKind = kind; previousAt = now;
  if (dismissal) { clearTimeout(dismissal); dismissal = undefined; }
  label.textContent = value;
  panel.dataset.kind = kind;
  panel.classList.add('visible');
  panel.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  // Keep an actual pending operation visible, and expire every outcome.
  if (kind !== 'working') {
    dismissal = setTimeout(() => {
      panel.classList.remove('visible');
      dismissal = undefined;
    }, kind === 'bad' || kind === 'warn' ? 7500 : kind === 'good' ? 2700 : 4000);
  }
}

/** Clear only an in-progress notice, never an error/success emitted meanwhile. */
export function finishActivity(expectedPrefix = ''): void {
  const panel = document.getElementById('toast');
  if (panel?.dataset.kind === 'working' && (!expectedPrefix || panel.querySelector('.activity-message')?.textContent?.startsWith(expectedPrefix)))
    panel.classList.remove('visible');
}

export function simpleActivity(message: string, error = false): void {
  if (!message.trim()) return;
  const kind: ActivityKind = error || /失敗|エラー|できません|未取得|未保存|不備|確認できません/.test(message)
    ? 'bad'
    : /保存中|取得中|読込中|読み込み中|同期中|削除中|接続中|保存しています|取得しています|同期しています|検証しています|処理中|変更しています|再暗号化中|更新しています|削除しています/.test(message)
      ? 'working'
      : /注意|警告|二重計上|未設定|確認してください/.test(message)
        ? 'warn' : /保存しました|取得しました|削除しました|更新しました|完了|解除しました|変更しました|登録しました|復号しました/.test(message)
          ? 'good' : 'info';
  showActivity(message, kind);
}
