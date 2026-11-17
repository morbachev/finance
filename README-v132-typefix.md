# Finance v1.3.2 Payroll連携 TypeScript型エラー修正

## 内容
- `src/cloud/payroll-bridge.ts`: AES-GCM復号時の `additionalData` を所有バッファ上の `Uint8Array` にコピーし、TypeScript 5.9.3 / DOM `BufferSource` の型要件を満たすよう変更。
- `dist/src/cloud/payroll-bridge.js`: 同修正のコンパイル済みJS。
- 暗号方式、パスフレーズ、保存先、Payroll収入データ形式は変更なし。

## 適用
`cd ~/Documents/finance && unzip -o ~/Downloads/finance-v132-payroll-typescript-fix.zip -d ~/Documents/finance && npm run check && npm run test && npm run verify:cloud`

## 検証
- 元の Finance v1.3.2 上でTS2322を再現。
- 変更後TypeScript 5.9.3による `tsc --noEmit` と emit 成功。
- Node組み込みテスト 178/178 件成功。
- `verify:cloud` 成功。
- このLinux環境のMac向けesbuildバイナリは実行できず、`npm run build` の一括実行は未検証。Macで `npm run test` が成功するか確認してください。
