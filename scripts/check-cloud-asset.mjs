import { stat } from 'node:fs/promises';
const file = 'dist/vendor/msal/msal-browser.bundle.js';
try {
  const info = await stat(file);
  if (!info.isFile() || info.size < 1000) throw new Error('size');
  console.log(`OneDrive認証モジュールOK: ${file} (${Math.round(info.size / 1024)} KiB)`);
} catch {
  console.error('OneDrive認証モジュールがありません。npm install && npm run build を実行してください。');
  process.exitCode = 1;
}
