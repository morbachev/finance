/** Optional, short-lived tab session. This stores a raw AES key in sessionStorage.
 * It is opt-in because scripts running in this origin can read sessionStorage.
 * Never store the passphrase, plaintext statements or PDF data here.
 */
export const TAB_SESSION_KEY = 'finance-vault-tab-key-v1';
export const TAB_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
interface SessionStorageLike {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem(key:string):void;
}
interface SessionEntry {
  format:'finance-vault-tab-key-v1';
  clientId:string;
  salt:string;
  key:string;
  dataSetId?:string|null;
  expiresAt:number;
}
const clientIdPattern=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const base64Pattern=/^[A-Za-z0-9+/]+={0,2}$/;
const validBase64=(s:string,byteLength:number)=>typeof s==='string'&&base64Pattern.test(s)&&s.length===Math.ceil(byteLength/3)*4;
export function clearTabSession(storage:SessionStorageLike):void {
  storage.removeItem(TAB_SESSION_KEY);
}
export function saveTabSession(storage:SessionStorageLike,clientId:string,salt:string,key:string,now=Date.now(),dataSetId:string|null=null):void {
  if(!clientIdPattern.test(clientId)||!validBase64(salt,16)||!validBase64(key,32))throw new Error('タブ用の復号情報が不正です。');
  const entry:SessionEntry={format:'finance-vault-tab-key-v1',clientId,salt,key,dataSetId,expiresAt:now+TAB_SESSION_TTL_MS};
  storage.setItem(TAB_SESSION_KEY,JSON.stringify(entry));
}
export function readTabSession(storage:SessionStorageLike,clientId:string,now=Date.now()):SessionEntry|null {
  const saved=storage.getItem(TAB_SESSION_KEY);
  if(!saved)return null;
  try {
    const entry=JSON.parse(saved) as Partial<SessionEntry>;
    if(entry?.format==='finance-vault-tab-key-v1'&&entry.clientId===clientId&&
      typeof entry.expiresAt==='number'&&Number.isFinite(entry.expiresAt)&&entry.expiresAt>now&&
      entry.expiresAt<=now+TAB_SESSION_TTL_MS&&validBase64(entry.salt!,16)&&validBase64(entry.key!,32)&&
      (entry.dataSetId==null||/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(entry.dataSetId))) {
      return entry as SessionEntry;
    }
  }catch { /* Corrupt or stale sessions are discarded. */ }
  clearTabSession(storage);
  return null;
}
