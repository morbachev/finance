import test from 'node:test';
import assert from 'node:assert/strict';
import { OneDriveTestClient } from '../dist/src/cloud/onedrive-api.js';
const graph='https://graph.microsoft.com/v1.0';
test('Live vault Graph API uses If-Match on upload session and never leaks bearer to chunk URL',async()=>{
  const calls=[];
  const fake=async(url,init)=>{
    calls.push({url,init});
    if(url===graph+'/me/drive/special/approot')return Response.json({id:'root-1'});
    if(url===graph+'/me/drive/items/existing-1/createUploadSession'){
      assert.equal(init.headers['If-Match'],'"etag123"');
      assert.equal(init.headers.Authorization,'Bearer secret');
      return Response.json({uploadUrl:'https://up.example.test/session'});
    }
    if(url==='https://up.example.test/session'){
      assert.equal(init.headers?.Authorization,undefined);
      assert.equal(init.credentials,'omit');
      assert.match(init.headers['Content-Range'],/^bytes 0-\d+\/\d+$/);
      return Response.json({id:'existing-1',eTag:'"etag124"'},{status:200});
    }
    throw Error('unexpected '+url);
  };
  const client=new OneDriveTestClient('secret',fake);
  await client.writeLiveVault('encrypted-payload',{id:'existing-1',etag:'"etag123"'});
  assert.equal(calls.filter(c=>c.url.startsWith('https://up.')).length,1);
});
test('Live vault Graph API distinguishes no cloud vault from a generic HTTP error',async()=>{
  const client=new OneDriveTestClient('secret',async url=>{
    if(url===graph+'/me/drive/special/approot')return Response.json({id:'root-1'});
    return Response.json({error:{code:'itemNotFound'}},{status:404});
  });
  assert.equal(await client.readLiveVault(),null);
});
test('Live vault file metadata and ciphertext download are separate protected requests',async()=>{
  const calls=[];
  const client=new OneDriveTestClient('secret',async (url,init)=>{
    calls.push({url,init});
    if(url===graph+'/me/drive/special/approot')return Response.json({id:'root'});
    if(url===graph+'/me/drive/items/root:/finance-v1-vault.enc')return Response.json({id:'vault-id',eTag:'"a"'});
    if(url===graph+'/me/drive/items/vault-id')return Response.json({id:'vault-id',size:100,'@microsoft.graph.downloadUrl':'https://down.example.test/blob'});
    if(url==='https://down.example.test/blob'){
      assert.equal(init.headers?.Authorization,undefined);
      assert.equal(init.credentials,'omit');
      return new Response('encrypted text',{status:200});
    }
    throw Error('unexpected '+url);
  });
  assert.deepEqual(await client.readLiveVault(),{text:'encrypted text',id:'vault-id',etag:'"a"'});
  assert.equal(calls.length,4);
});
