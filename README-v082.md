# Finance v0.8.2 UIパッチ

v0.8.1 に上書き適用する小規模な画面調整です。

- STEP 03の「カード」ラベルを撤去（表示名はそのまま残ります）。
- STEP 03の取引一覧をカード端から少し内側に寄せ、枠線と角丸を付けます。
- 「明細を解析する」ボタンを今の淡色デザインのまま、貼り付け欄の横幅いっぱいに広げます。
- サイドバーのバージョン表示を v0.8.2 に更新します。

取込処理・暗号化・IndexedDB・一括保存の実装は変更していません。

## 適用方法

```bash
cd ~/Documents/finance
unzip -o ~/Downloads/finance-v082-patch.zip -d ~/Documents/finance
npm run check
npm run test
```

実行中のWebサーバーを止める必要はありません。ブラウザは Cmd + Shift + R で更新してください。
