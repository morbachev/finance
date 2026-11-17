# Finance v0.9.3 | パスフレーズ入力UX改善

v0.9.2へ適用する差分パッチ。OneDrive接続・暗号化・IndexedDB保存のデータ形式は変更しない。

## 変更点

- 3つのパスフレーズ欄（ローカル保管庫の入力・確認、OneDriveテスト）の`autocomplete="off"`を見直し、1Passwordやブラウザのパスワードマネージャーが入力欄を認識しやすいようにした。
  - ローカル保管庫の新規作成は`new-password`、解除と復元は`current-password`を動的に設定。
  - 確認用入力欄は`new-password`、OneDriveテスト用は`current-password`。
  - モバイルの自動大文字化・自動修正は無効。
- すべてのパスフレーズ欄に「表示／隠す」を追加。入力文字列を変更せず表示状態だけを切り替える。切り替え後は入力欄へフォーカスを戻す。
- コピペの標準イベントを妨害する処理は追加していない。スペース・改行なども勝手にトリミングしない（パスフレーズの内容は厳密一致）。
- OneDriveの暗号化テストはアップロード成功後もパスフレーズ欄を維持し、そのまま「OneDriveから取得・復号」を押せる。復号成功後は入力内容を消し、表示を伏せ字へ戻す。
- 保管庫のダイアログを閉じる際も、秘密の値を消去して伏せ字へ戻す。
- 明細の保存先は引き続きブラウザ内の暗号化IndexedDB。OneDriveに保存されるのは接続テスト用の暗号化ランダムデータだけで、自動同期はまだ未実装。

## Macで適用

```bash
cd ~/Documents/finance || exit 1
unzip -o ~/Downloads/finance-v093-password-ux.zip -d ~/Documents/finance
npm run check && npm run test && npm run verify:cloud
```

`npm run test`内部でビルドが行われる。完了後、`http://localhost:5173/`を`⌘ + Shift + R`で強制再読み込み。GitHub Pagesも更新したい場合は`dist`のデプロイが必要。

## 確認する操作

1. 左ナビ「OneDrive接続」で、1Passwordからテスト用パスフレーズを貼り付ける。
2. 「表示／隠す」が入力内容を変えないことを確認する。
3. テストファイルをアップロードした後、貼り直さずに取得・復号できることを確認する。成功後は欄が消去される。
4. ローカル保存の解除ダイアログと新規作成ダイアログでも貼り付けが可能なことを確認する。

## 検証

- TypeScript型チェック成功
- 自動テスト38件成功（追加5件）
- Chromiumのデスクトップ幅1440px・スマホ幅390pxで、文字列保持・表示切り替え・フォーカス・リセット・水平オーバーフローを確認
- 実際の1Password拡張機能からの入力は利用端末側での確認が必要

## 変更ファイル

- `public/index.html` / `dist/index.html`
- `public/styles/style.css` / `dist/styles/style.css`
- `src/main.ts` / `dist/src/main.js`
- `src/cloud/cloud-settings.ts` / `dist/src/cloud/cloud-settings.js`
- `src/ui/password-fields.ts` / `dist/src/ui/password-fields.js`（新規）
- `tests/password-fields.test.mjs`（新規）
- `package.json`
- `README-v093.md`
