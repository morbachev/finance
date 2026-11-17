# Finance v1.1.0 | OneDriveの年別・月別ディレクトリ構造

v1.0.0に上書きするパッチです。**OneDriveが唯一の正式な保存先**であることは変わりません。IndexedDBへの新規保存・通常読み込みは行いません。

## 保存ディレクトリ

同じMicrosoft EntraのClient IDをPayrollにも設定した場合、同じアプリ専用領域内の別フォルダに保存できます。

```text
OneDrive / Apps / <Microsoft Entraアプリ表示名> /
├── finance/
│   ├── index.enc                            # 暗号化済み年度索引（元データの中身は含めない）
│   ├── statements/
│   │   ├── 2025.enc                         # 2025年の解析結果、取引行、削除履歴、競合履歴
│   │   ├── 2026.enc                         # 2026年の同上
│   │   └── undated.enc                      # 請求年月不明のデータがある場合のみ
│   └── originals/
│       ├── 2025/12/<UUID>.enc              # 暗号化されたPDF原本
│       └── 2026/11/<UUID>.enc
├── payroll/                                # 将来のPayroll用の空の名前空間のみ作成
│   └── (給与データの実装は今後)
├── finance-v1-vault.enc                    # 旧v1.0の暗号化保管庫（移行後も残す）
├── finance-v1-originals/                   # 旧v1.0の暗号化原本（移行後も残す）
└── finance-vault-*.enc.json                # 旧v0.9.4バックアップ（従来どおり保持）
```

- `finance/`と`payroll/`は同じアプリ登録の`Files.ReadWrite.AppFolder`権限の内側に置きます。
- Payrollの**給与データ保存やFinance側の給与参照はまだ実装していません**。空フォルダは予約領域です。
- 年別の基準は**請求年月**。請求年月不明の明細は`undated.enc`に収録します。
- PDF原本は**取り込んだときの請求年月**で保管します。後から明細の請求年月を変更してもPDFの保存場所は変えず、暗号化済み解析データに原本の保存年月を保持します。
- 解析データ、年度索引、PDFはすべてAES-256-GCM暗号化。年・月フォルダ名とファイル名（UUID）はOneDrive上で見えますが、カード名や利用先は暗号化されます。
- 明細を編集しても**同じ年の暗号化ファイルだけ**が更新されます。異なる年の編集は別のファイルになり、更新競合を減らせます。
- 年別ファイルはMicrosoft GraphのETagで条件付き更新し、3方向マージで競合する項目を統合します。`index.enc`もETagで保護されます。
- 複数年を同時に一括保存する場合、OneDriveは複数ファイルの**原子的な一括確定を提供しません**。途中で失敗した場合は未保存と表示され、再試行します。同じ明細のIDは保持され、重複登録を防ぎます。

## v1.0.0のOneDriveデータの自動移行

v1.0.0の`finance-v1-vault.enc`を読み込む設定がある場合、v1.1.0で**初めて保管庫を解除したときに自動的に移行**します。

1. 旧保管庫を従来のパスフレーズで復号します。
2. 旧PDF原本の暗号化データを年/月別フォルダへコピーし、OneDriveから読み戻して一致を確認します。
3. 旧解析データを請求年ごとの暗号化ファイルに分割し、読み戻して整合性を確認します。
4. **すべて成功してから**`finance/index.enc`を作成し、新構造を有効にします。
5. 旧`finance-v1-vault.enc`、`finance-v1-originals/`、従来のバックアップ、IndexedDBは削除しません。

通信失敗などで途中中断した場合、新索引を公開する前なら旧保管庫から再実行できます。

**重要：移行後にFinance v1.0.0から保存しないでください。** v1.0.0は旧単一ファイルしか認識せず、新構造とデータが分岐します。Mac・Galaxyの両方でv1.1.0以降を使用してください。

旧IndexedDBからの移行ボタンはこれまでどおり動作します。新規保存先は年別ファイルになります。

## Macへの適用

作業前に、旧Financeで暗号化バックアップをOneDriveまたはローカルZIPへ保存しておくことを推奨します。

```bash
cd ~/Documents/finance || exit 1
unzip -o ~/Downloads/finance-v110-year-layout.zip -d ~/Documents/finance
npm install
npm run check
npm run test
npm run verify:cloud
```

成功したらブラウザで強制更新（Mac: `⌘ Shift R`）して、同じアカウントでOneDriveにログインし、保管庫を解除してください。初回はデータ量とネットワーク状況により複数ファイルのアップロードが発生します。

必ず以下を確認してください。

- OneDriveで`finance/index.enc`と年度ごとの`finance/statements/YYYY.enc`が作成されている。
- PDFを保存した月の`finance/originals/YYYY/MM/`に暗号化ファイルがある。
- 明細件数・請求総額・PDF原本の再閲覧が移行前と一致する。
- 2026年の明細を修正したとき2025年のファイルを再アップロードしない。
- Galaxyにも更新版をデプロイし、同じ明細を復号できる。

このパッチにはユーザーのPDFや明細内容、認証Client ID、パスフレーズは含めていません。

## 検証範囲

- TypeScriptの型チェック、年別保存・競合・移動・原本参照・旧保管庫移行の自動テスト
- Microsoft Graph APIを模擬した年月別フォルダの作成とETag、暗号化ファイル送受信のテスト
- 実際のMicrosoft OneDriveアカウントを使ったクラウド通信・移行はMac/Galaxy実機での確認が必要
