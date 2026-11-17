# Finance v0.9.2 — OneDrive fetch Illegal invocation hotfix

## 対象
Finance v0.9.1（v0.9.0 + TypeScript型エラー修正パッチ適用済み）

## 原因と修正
`src/cloud/onedrive-api.ts` の `OneDriveTestClient` において、`fetch` をそのままHTTPクライアントの既定値として保持し、`this.http()` で呼び出すことで、Windowのネイティブ関数に必要なthisが異なる問題を修正した。

既定のHTTP関数を `(input, init) => globalThis.fetch(input, init)` に変更し、Web APIの呼び出し時に正しいレシーバーが与えられるようにした。

- OneDriveの保存先・ファイル名は変更していません。
- MSAL認証設定、Client ID、暗号化方式、保存済み明細形式は変更していません。
- `fetch` の呼び出し元を検査する回帰テストを追加しました。
- サイドバーのバージョン表示を0.9.2に更新しました。

## Macへの適用
```bash
cd ~/Documents/finance || exit 1
unzip -o ~/Downloads/finance-v092-fetch-fix.zip -d ~/Documents/finance
npm run check && npm run build && npm run test && npm run verify:cloud
```

`npm run verify:cloud` のみ、MSALが未インストールなら `npm install` を実行し、続けて `npm run build && npm run verify:cloud` を実行してください。

ブラウザ側は強制再読込（Mac: Cmd+Shift+R）後、OneDrive接続 → アプリ専用フォルダの接続確認を試してください。

## 検証
ローカルで TypeScript型チェック、33件の自動テスト成功。
Microsoftアカウントに対する実通信はユーザーのMacで確認が必要です。
