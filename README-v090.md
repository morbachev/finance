# Finance v0.9.0 | OneDrive接続の検証

v0.8.6をベースにした差分パッチ。明細・PDF原本のクラウド同期は **まだ行いません**。

## 今回追加したもの

- 左ナビの「OneDrive接続」画面。入力するのは**公開Client ID**だけ。Client Secretは作らない／入力しない。
- 個人用Microsoftアカウント認証（MSAL Browser、認可コード＋PKCE）。認証キャッシュはsessionStorage。
- Microsoft Graph `Files.ReadWrite.AppFolder` による**アプリ専用フォルダだけの接続確認**。
- テスト用データだけをPBKDF2-SHA256（310,000回）＋AES-256-GCMでブラウザ内暗号化し、OneDriveにアップロード。
- 別端末から同じアカウントとパスフレーズで復号するテスト。暗号化ソルトはファイルに含むためMacのIndexedDBを必要としない。
- Microsoft Graphのダウンロードは`/content`ではなく、ファイルメタデータの`@microsoft.graph.downloadUrl`を使う（ブラウザのCORS対策）。ダウンロードURLにはBearerトークンを送信しない。
- 既存の明細パーサー、一括取込、ローカル暗号化保存、ZIPバックアップの形式は変更なし。

## 1. Macへのパッチ適用

先にダウンロードしたパッチZIPを `~/Downloads/finance-v090-patch.zip` に置く。

```bash
cd ~/Documents/finance
unzip -o ~/Downloads/finance-v090-patch.zip -d ~/Documents/finance
npm install
npm run check
npm run test
npm run verify:cloud
python3 -m http.server 5173 --directory dist
```

`npm install`が**今回必要**。`@azure/msal-browser@5.29.0`と`esbuild`が追加され、ビルド時に`dist/vendor/msal/msal-browser.bundle.js`が生成される。

`npm run verify:cloud`が失敗したままOneDrive接続へ進まないこと。

ブラウザ：`http://localhost:5173/`

既にPythonサーバーが起動中なら二重起動せず、`npm run test`後に `⌘ + Shift + R` で更新。

## 2. Microsoft Entraでアプリ登録

公式： https://learn.microsoft.com/ja-jp/graph/auth-register-app-v2

管理画面： https://entra.microsoft.com/

Microsoft GraphのAPI認証にはアプリ登録が**必須**。Microsoft 365 PersonalのOneDriveを持っているだけではClient IDは自動発行されない。

1. Microsoft Entraの **ID > アプリの登録 > 新規登録** でアプリ名を `Finance Personal` などにする。
2. サポート対象アカウントを **個人用 Microsoft アカウントのみ** にする（画面で利用できない場合は「組織のアカウントと個人用Microsoftアカウント」を選び、アプリ側では個人用の`/consumers`に接続する）。
3. **認証 > プラットフォームを追加 > シングルページ アプリケーション（SPA）** で、Financeの接続画面に表示されたリダイレクトURIをそのまま登録する。ローカル利用例は `http://localhost:5173/`。
4. MacとGalaxyの両方で使う場合、GitHub Pages等にHTTPSで公開したFinanceのURLも、**同じアプリ登録のSPAリダイレクトURI**に追加する。Galaxyの`localhost`はMacにはつながらない。
5. **APIのアクセス許可 > Microsoft Graph > 委任されたアクセス許可** で `Files.ReadWrite.AppFolder` を追加。これ以外の広いファイル権限を安易に許可しない。
6. 概要から **アプリケーション（クライアント）ID** をコピーしてFinanceの「OneDrive接続」に貼り付けて保存する。
7. 接続ボタンでMicrosoft認証。本人の個人用Microsoftアカウントで許可し、「アプリ専用フォルダの接続確認」を押す。

アプリの登録にはMicrosoft Entraテナントの権限が必要。テナントを持っていない場合は、無料Azure/Entra登録が別途必要になることがある。これはOneDriveストレージ契約とは別の手続き。料金条件はMicrosoftの登録画面で確認すること。

`Files.ReadWrite.AppFolder`はMicrosoft公式ドキュメント上でもプレビュー扱いのため、最初の接続テストで利用可否を確認する。エラーが出てもアプリが勝手に権限を増やすことはない。

## 3. 暗号化テスト（金融データは送らない）

1. 同じ画面の STEP 03で**12文字以上のテスト用パスフレーズ**を入力する。1Passwordで管理してもよい。
2. 「暗号化してアップロード」を押す。上書き確認後、`Apps/<アプリ登録名>/finance-v09-connectivity.enc.json` に暗号文だけ保存する。
3. 同じパスフレーズを入力して「OneDriveから取得・復号」。**復号成功とランダムな検証ID**が表示されればMac内での往復テスト成功。
4. GalaxyでFinanceをHTTPSサイトから開き、同じClient IDを登録。Microsoftログイン、フォルダ接続確認を行う。
5. 同じパスフレーズで「OneDriveから取得・復号」。Macと同じ検証ID・日時が表示されれば**端末間テスト成功**。

テストファイルは繰り返しアップロードすると上書きされる。実金融データは含まない。テストファイルをOneDrive上で削除しても、FinanceのIndexedDB明細には影響しない。

## 安全性と未実装事項

- Finance内の**実際の明細・PDF・IndexedDBのデータはOneDriveにアップロードしない**。
- この接続テストファイルの暗号化ソルトは暗号文と一緒にOneDriveに保存するが、**復号パスフレーズは保存・送信しない**。文字列の平文検証IDもアップロードしない。
- Client IDだけlocalStorageに保存。Microsoftの認証トークンはMSALのsessionStorage。金融データの暗号鍵は既存と同じくメモリのみ。
- 重要：Microsoftのログイン・リダイレクトにより画面が再読み込みされることがあるため、未保存の明細は先に一括取込・暗号化バックアップする。
- Mac側のFinanceとGalaxy側のFinanceは、まだ明細を同期できない。テストデータが行き来できることの確認まで。
- OneDriveの暗号化ファイルには手動削除・上書きリスクがある。自動同期時にはETagによる競合検知と同期失敗時の復旧手順を導入する。
- GitHub Pagesは公開サイト。アプリ登録IDは公開識別子であり秘密鍵ではないが、Client Secretは絶対に静的コードへ記載しない。

## 内部モジュール

- `src/cloud/test-envelope.ts`: 接続テスト用の自己完結型暗号化形式
- `src/cloud/onedrive-api.ts`: Microsoft Graphの最小権限フォルダ取得・テストファイル送受信
- `src/cloud/cloud-settings.ts`: MSAL redirect認証と設定UI
- `scripts/build-msal.mjs`: npm導入済みMSALをバンドルし自サイト内配信
- `scripts/check-cloud-asset.mjs`: 認証ライブラリがビルド済みかチェック
- `tests/onedrive-connectivity.test.mjs`: 暗号化・改ざん・Graph API権限のモックテスト

## 公式資料

- アプリ登録: https://learn.microsoft.com/en-us/graph/auth-register-app-v2
- アプリフォルダ: https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder
- MSAL初期化: https://learn.microsoft.com/en-us/entra/msal/javascript/browser/initialization
- JavaScriptダウンロードのCORS: https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0
