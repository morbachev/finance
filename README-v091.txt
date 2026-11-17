Finance v0.9.1: MSAL/OneDrive connection probe TypeScript fix

Scope: src/cloud/test-envelope.ts, dist/src/cloud/test-envelope.js only.
Change: explicitly copy decoded IV and ciphertext into ArrayBuffer-backed Uint8Arrays before Web Crypto decrypt. Encryption, key derivation, serialized test envelope, and local saved finance data are unchanged.

Apply from your Mac:
cd ~/Documents/finance || exit 1
unzip -o ~/Downloads/finance-v091-typefix.zip -d ~/Documents/finance
npm run check && npm run build && npm run test && npm run verify:cloud

Full project regression tests: 32/32 pass using the TypeScript compiler available in this build environment.
Microsoft login/upload tests still require a real Microsoft account and browser.
