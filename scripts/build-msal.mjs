import { mkdir, stat } from 'node:fs/promises';
const isInstalled = async (p) => { try { await stat(p); return true; } catch { return false; } };
const msalPresent = await isInstalled('node_modules/@azure/msal-browser/package.json');
const esbuildPresent = await isInstalled('node_modules/esbuild/package.json');
if (!msalPresent || !esbuildPresent) {
  console.warn('MSAL: 未インストール。npm install && npm run build でOneDrive認証モジュールを生成してください。');
} else {
  const { build } = await import('esbuild');
  await mkdir('dist/vendor/msal', { recursive: true });
  await build({
    entryPoints: ['scripts/msal-entry.mjs'],
    outfile: 'dist/vendor/msal/msal-browser.bundle.js',
    format: 'esm', platform:'browser', bundle:true, minify:true, target:'es2022',
    legalComments: 'none',
  });
  console.log('MSAL: dist/vendor/msal/msal-browser.bundle.js を生成しました。');
}
