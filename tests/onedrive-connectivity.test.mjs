import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncryptedProbe, decryptEncryptedProbe, PROBE_FILE_NAME } from '../dist/src/cloud/test-envelope.js';
import { OneDriveTestClient, GraphError } from '../dist/src/cloud/onedrive-api.js';

const PASSPHRASE = 'strong-example-passphrase-not-financial';

test('Cloud probe encrypts a self-contained random marker, never plaintext or password', async () => {
  const { encrypted, probe } = await createEncryptedProbe(PASSPHRASE);
  assert.ok(encrypted.includes('finance-test-only'));
  assert.equal(encrypted.includes(PASSPHRASE), false);
  assert.equal(encrypted.includes(probe.nonce), false);
  assert.equal(encrypted.includes(probe.createdAt), false);
  assert.deepEqual(await decryptEncryptedProbe(encrypted, PASSPHRASE), probe);
  assert.notEqual((await createEncryptedProbe(PASSPHRASE)).encrypted, encrypted);
});

test('Cloud probe refuses incorrect passphrase, tampering and excessive KDF iterations', async () => {
  const { encrypted } = await createEncryptedProbe(PASSPHRASE);
  await assert.rejects(decryptEncryptedProbe(encrypted, 'invalid-password-goes-here'), /復号できません/);
  const tampered = JSON.parse(encrypted);
  tampered.ciphertext = tampered.ciphertext.replace(/.$/, tampered.ciphertext.endsWith('A') ? 'B' : 'A');
  await assert.rejects(decryptEncryptedProbe(JSON.stringify(tampered), PASSPHRASE));
  tampered.iterations = 999_999_999;
  await assert.rejects(decryptEncryptedProbe(JSON.stringify(tampered), PASSPHRASE), /対応していない/);
});

test('Cloud probe rejects too-short passphrases and overlong files', async () => {
  await assert.rejects(createEncryptedProbe('short'), /12文字/);
  await assert.rejects(decryptEncryptedProbe('X'.repeat(25000), PASSPHRASE), /大きすぎます/);
});

test('Graph appfolder upload and download use correct authorization boundaries', async () => {
  const graphCalls = [];
  let testFile = '';
  const fakeFetch = async (input, init) => {
    graphCalls.push({url:input, init});
    if (input.endsWith('/me/drive/special/approot')) return Response.json({id:'root!folder'});
    if (input.endsWith(`/${PROBE_FILE_NAME}:/content`) && init.method === 'PUT') {
      assert.match(init.headers.Authorization, /^Bearer TEST_TOKEN$/);
      testFile = init.body;
      return Response.json({id:'f1'});
    }
    if (input.endsWith('/' + PROBE_FILE_NAME) && !init.method) return Response.json({id:'f1','@microsoft.graph.downloadUrl':'https://files.example.test/payload'});
    if (input === 'https://files.example.test/payload') {
      assert.equal(init.headers?.Authorization, undefined);
      assert.equal(init.credentials, 'omit');
      return new Response(testFile, {status:200});
    }
    throw Error(`Unexpected request ${input}`);
  };
  const api = new OneDriveTestClient('TEST_TOKEN', fakeFetch);
  const { encrypted } = await createEncryptedProbe(PASSPHRASE);
  await api.uploadEncryptedProbe(encrypted);
  assert.deepEqual(await decryptEncryptedProbe(await api.downloadEncryptedProbe(), PASSPHRASE), await decryptEncryptedProbe(encrypted,PASSPHRASE));
  const upload = graphCalls.find(c => c.init.method === 'PUT');
  assert.match(upload.url, /\/me\/drive\/items\/root!folder:\/finance-v09-connectivity\.enc\.json:\/content$/);
  assert.equal(graphCalls.filter(c => c.url.endsWith('/content') && c.init.method !== 'PUT').length, 0);
});

test('Graph errors are preserved as a status code without exposing sensitive bodies', async () => {
  const api = new OneDriveTestClient('x', async () => Response.json({error:{code:'accessDenied',message:'SECRET-DO-NOT-EXPOSE'}}, {status:403}));
  await assert.rejects(api.appFolderId(), error => {
    assert.ok(error instanceof GraphError);
    assert.equal(error.status, 403);
    assert.equal(error.code, 'accessDenied');
    assert.equal(error.message.includes('SECRET'), false);
    return true;
  });
});

test('Graph blocks non-HTTPS download URL from metadata', async () => {
  const fakeFetch = async (url) => {
    if (url.endsWith('/me/drive/special/approot')) return Response.json({id:'folder'});
    return Response.json({id:'f1','@microsoft.graph.downloadUrl':'http://insecure.test/file'});
  };
  const api = new OneDriveTestClient('x', fakeFetch);
  await assert.rejects(api.downloadEncryptedProbe(), /安全なダウンロードURL/);
});


test('Default Graph fetch preserves the browser global receiver (Illegal invocation regression)', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  // Mimic the WebIDL receiver check performed by Window.fetch in browsers.
  globalThis.fetch = function(input, init) {
    assert.equal(this, globalThis);
    assert.equal(input, 'https://graph.microsoft.com/v1.0/me/drive/special/approot');
    assert.equal(init.headers.Authorization, 'Bearer TEST_TOKEN');
    called = true;
    return Promise.resolve(Response.json({ id: 'folder-v092' }));
  };
  try {
    const api = new OneDriveTestClient('TEST_TOKEN');
    assert.equal(await api.appFolderId(), 'folder-v092');
    assert.equal(called, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
