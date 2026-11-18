/** Microsoft Graph API client for the encrypted Finance vault and connectivity checks. */
import { PROBE_FILE_NAME } from './test-envelope.js';
import { FINANCE_DIR, PAYROLL_DIR, checkBucket, checkOriginalMonth, originalParts } from './layout.js';
import { asSnapshots, isSnapshotName, MAX_SNAPSHOT_BYTES, snapshotName, validateBackupText, type VaultSnapshot } from './vault-snapshots.js';
const GRAPH = 'https://graph.microsoft.com/v1.0';

interface DriveItem { id: string; name?: string; size?: number; eTag?: string; createdDateTime?: string; '@microsoft.graph.downloadUrl'?: string }
export class GraphError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(`OneDrive APIエラー (${status}${code ? ` / ${code}` : ''})。権限・接続・アカウントを確認してください。`);
  }
}

export class OneDriveTestClient {
  // Resolve Graph folder IDs once per client session. These are non-secret IDs,
  // retained only in memory; a new sign-in/client receives a fresh cache.
  private appRoot: Promise<string> | null = null;
  private dataSetId:string|null=null;
  /** v2 data sets are isolated; only index.enc remains at the stable root. */
  setVaultDataSet(id:string|null):void {
    if(id!==null&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))throw new Error('保管庫世代IDが不正です。');
    this.dataSetId=id;
  }
  forVaultDataSet(id:string):OneDriveTestClient {
    const stage=new OneDriveTestClient(this.token,this.http);stage.setVaultDataSet(id);return stage;
  }
  private financeDataPath(...tail:string[]):string[] {
    return this.dataSetId?[FINANCE_DIR,'versions',this.dataSetId,...tail]:[FINANCE_DIR,...tail];
  }
  private readonly directoryIds = new Map<string, string>();
  private readonly resolvingDirectories = new Map<string, Promise<string | null>>();
  private clearDirectoryCache(): void {
    this.directoryIds.clear();
    this.resolvingDirectories.clear();
    this.appRoot = null;
  }
  // Browser fetch is a host method: passing it around unbound can trigger
  // `Failed to execute 'fetch' on 'Window': Illegal invocation`.
  // Call it through globalThis so the native receiver is preserved. Custom
  // HTTP functions can still be injected by tests.
  constructor(
    private readonly token: string,
    private readonly http: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {}
  /** GET-only deadline: an unreachable OneDrive must not leave the UI waiting forever.
   * Do not abort writes automatically: their server-side result may be uncertain. */
  private async httpWithReadTimeout(url:string, init:RequestInit):Promise<Response> {
    if((init.method??'GET').toUpperCase()!=='GET')return this.http(url,init);
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),30000);
    try {
      return await this.http(url,{...init,signal:controller.signal});
    }catch(error) {
      if(controller.signal.aborted)throw new Error('OneDriveの読み取りが30秒以内に完了しませんでした。通信環境とMicrosoft認証を確認してください。');
      throw error;
    }finally{clearTimeout(timeout);}
  }
  private async graph(path: string, init: RequestInit = {}, allowNotModified = false): Promise<Response> {
    const response = await this.httpWithReadTimeout(GRAPH + path, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...init.headers },
      redirect: 'error',
    });
    if (!response.ok && !(allowNotModified && response.status === 304)) {
      let code = '';
      try {
        const json = await response.json() as { error?: {code?: string} };
        code = typeof json.error?.code === 'string' ? json.error.code.slice(0, 80) : '';
      } catch { /* Errors can be HTML or empty. */ }
      throw new GraphError(response.status, code);
    }
    return response;
  }
  private async downloadItemInfo(id: string, maxBytes: number, supplied?: DriveItem): Promise<{text:string;item:DriveItem}> {
    let item = supplied;
    // Named-path lookups often already include the temporary download URL.
    // Otherwise fetch by ID exactly once (also gets the freshest ETag).
    if (!item?.['@microsoft.graph.downloadUrl'] || !item.eTag) {
      const response = await this.graph(`/me/drive/items/${encodeURIComponent(id)}`);
      item = await response.json() as DriveItem;
    }
    if (!item?.id) throw new Error('OneDriveのファイルIDを取得できませんでした。');
    if (item.size && item.size > maxBytes) throw new Error('OneDriveのファイルがサイズ上限を超えています。');
    const url = item['@microsoft.graph.downloadUrl'];
    if (!url || new URL(url).protocol !== 'https:') throw new Error('安全なダウンロードURLを取得できませんでした。');
    // A short-lived preauthenticated download URL MUST NOT receive the Graph bearer token.
    const result = await this.httpWithReadTimeout(url, { method:'GET', credentials:'omit' });
    if (!result.ok) throw new Error(`OneDriveからの取得に失敗しました (HTTP ${result.status})。`);
    if (Number(result.headers.get('Content-Length') ?? 0) > maxBytes) throw new Error('ダウンロードがサイズ上限を超えています。');
    // Stream when possible to bound memory before materializing a string.
    if (result.body) {
      const reader = result.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > maxBytes) throw new Error('ダウンロードがサイズ上限を超えています。');
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return {text:new TextDecoder('utf-8', {fatal:true}).decode(bytes),item};
    }
    const text = await result.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('ダウンロードがサイズ上限を超えています。');
    return {text,item};
  }
  private async downloadItem(id: string, maxBytes: number): Promise<string> {
    return (await this.downloadItemInfo(id,maxBytes)).text;
  }

  async listVaultSnapshots(): Promise<VaultSnapshot[]> {
    const folder = await this.appFolderId();
    const response = await this.graph(`/me/drive/items/${encodeURIComponent(folder)}/children?$select=id,name,size,createdDateTime&$top=200`);
    const data = await response.json() as { value?: unknown; '@odata.nextLink'?: string };
    // No implicit traversal to arbitrary URLs and no silent incomplete listing.
    if (data['@odata.nextLink']) throw new Error('スナップショットが200件を超えました。手動整理が必要です。');
    return asSnapshots(data.value);
  }

  async uploadVaultSnapshot(text: string): Promise<VaultSnapshot> {
    validateBackupText(text);
    const folder = await this.appFolderId();
    const name = snapshotName(new Date(), crypto.randomUUID());
    const namePath = `/me/drive/items/${encodeURIComponent(folder)}:/${encodeURIComponent(name)}:`;
    const payload = new TextEncoder().encode(text);
    let item: DriveItem;
    if (payload.byteLength <= 4 * 1024 * 1024) {
      // Graph's conflictBehavior=fail disallows accidental replacement of an existing filename.
      const response = await this.graph(`${namePath}/content?@microsoft.graph.conflictBehavior=fail`, {
        method:'PUT', headers:{'Content-Type':'application/octet-stream'}, body: payload,
      });
      item = await response.json() as DriveItem;
    } else {
      // Large PDF-backed vaults use Graph upload sessions. 3,276,800 bytes = 10 x 320 KiB.
      const sessionResponse = await this.graph(`${namePath}/createUploadSession`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({item:{'@microsoft.graph.conflictBehavior':'fail'}}),
      });
      const session = await sessionResponse.json() as { uploadUrl?: string };
      if (!session.uploadUrl || new URL(session.uploadUrl).protocol !== 'https:') {
        throw new Error('OneDriveの安全なアップロードURLを取得できませんでした。');
      }
      const chunkSize = 320 * 1024 * 10;
      item = {} as DriveItem;
      for (let start = 0; start < payload.byteLength; start += chunkSize) {
        const end = Math.min(start + chunkSize, payload.byteLength);
        const chunk = payload.slice(start, end);
        // Preauthenticated uploadUrl: never pass the Graph bearer token.
        const part = await this.http(session.uploadUrl, {
          method:'PUT', credentials:'omit',
          headers:{'Content-Range':`bytes ${start}-${end-1}/${payload.byteLength}`},
          body:chunk,
        });
        if (!part.ok) throw new Error(`分割アップロードに失敗しました (HTTP ${part.status})。`);
        if (end < payload.byteLength) {
          if (part.status !== 202) throw new Error('OneDriveのアップロードが途中で終了しました。');
        } else {
          if (part.status !== 200 && part.status !== 201) throw new Error('OneDriveがアップロード完了を返しませんでした。');
          item = await part.json() as DriveItem;
        }
      }
    }
    if (!item.id) throw new Error('OneDriveの保存結果を確認できませんでした。');
    return { id:item.id, name, size:new TextEncoder().encode(text).byteLength, createdDateTime:item.createdDateTime ?? new Date().toISOString() };
  }

  async downloadVaultSnapshot(snapshot: VaultSnapshot): Promise<string> {
    if (!isSnapshotName(snapshot.name) || snapshot.size > MAX_SNAPSHOT_BYTES) throw new Error('選択されたバックアップが不正です。');
    // Never download an arbitrary OneDrive file id without verifying it is still one of our files.
    const current = (await this.listVaultSnapshots()).find(item => item.id === snapshot.id && item.name === snapshot.name);
    if (!current) throw new Error('選択されたスナップショットがOneDriveに見つかりません。');
    const text = await this.downloadItem(current.id, MAX_SNAPSHOT_BYTES);
    validateBackupText(text);
    return text;
  }

  /** The live encrypted document is independent from immutable v0.9 backups. */
  async readLiveVault(): Promise<{text:string; id:string; etag:string}|null> {
    const folder=await this.appFolderId();
    let item:DriveItem;
    try {
      const response=await this.graph(`/me/drive/items/${encodeURIComponent(folder)}:/finance-v1-vault.enc`);
      item=await response.json() as DriveItem;
    } catch(error) {
      if(error instanceof GraphError && error.status===404) return null;
      throw error;
    }
    if(!item.id||!item.eTag)throw new Error('OneDriveの更新情報（ETag）を取得できません。');
    return {text:await this.downloadItem(item.id,25_000_000),id:item.id,etag:item.eTag};
  }

  private async uploadSession(path:string, bytes:Uint8Array, etag?:string):Promise<DriveItem> {
    if(bytes.byteLength>200*1024*1024)throw new Error('アップロードサイズが200MBを超えています。');
    const response=await this.graph(path,{
      method:'POST',
      headers:{'Content-Type':'application/json',...(etag?{'If-Match':etag}:{})},
      body:JSON.stringify({item:{'@microsoft.graph.conflictBehavior':etag?'replace':'fail'}}),
    });
    const session=await response.json() as {uploadUrl?:string};
    if(!session.uploadUrl||new URL(session.uploadUrl).protocol!=='https:')throw new Error('安全なアップロードセッションを取得できません。');
    // 3,276,800 is a multiple of 320KiB; upload sequentially without the Graph bearer token.
    const size=3276800;
    for(let start=0;start<bytes.byteLength;start+=size) {
      const end=Math.min(start+size,bytes.byteLength);
      const part=await this.http(session.uploadUrl,{
        method:'PUT',credentials:'omit',
        headers:{'Content-Range':`bytes ${start}-${end-1}/${bytes.byteLength}`},
        body:bytes.slice(start,end),
      });
      if(!part.ok) {
        if(part.status===409||part.status===412)throw new GraphError(part.status,'conflict');
        throw new Error(`OneDriveへのアップロードが失敗しました (HTTP ${part.status})。`);
      }
      if(end<bytes.byteLength) {
        if(part.status!==202)throw new Error('OneDriveのアップロードが途中で終了しました。');
      } else {
        if(part.status!==200&&part.status!==201)throw new Error('OneDriveが保存完了を返しませんでした。');
        const item=await part.json() as DriveItem;
        if(!item.id)throw new Error('OneDriveの保存IDを取得できません。');
        return item;
      }
    }
    throw new Error('空のアップロードは許可されません。');
  }

  async writeLiveVault(text:string, existing: {id:string;etag:string}|null):Promise<void> {
    if(!text||new TextEncoder().encode(text).byteLength>25_000_000)throw new Error('暗号化明細がサイズ上限を超えています。');
    const bytes=new TextEncoder().encode(text);
    const folder=await this.appFolderId();
    const path=existing
      ? `/me/drive/items/${encodeURIComponent(existing.id)}/createUploadSession`
      : `/me/drive/items/${encodeURIComponent(folder)}:/finance-v1-vault.enc:/createUploadSession`;
    await this.uploadSession(path,bytes,existing?.etag);
  }

  private async originalsFolder(create:boolean):Promise<string|null> {
    const parent=await this.appFolderId();
    const path=`/me/drive/items/${encodeURIComponent(parent)}:/finance-v1-originals`;
    try {const response=await this.graph(path);const item=await response.json() as DriveItem;return item.id;}
    catch(error) {if(!(error instanceof GraphError&&error.status===404))throw error;}
    if(!create)return null;
    try {
      const response=await this.graph(`/me/drive/items/${encodeURIComponent(parent)}/children`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:'finance-v1-originals',folder:{},'@microsoft.graph.conflictBehavior':'fail'}),
      });
      const item=await response.json() as DriveItem;
      if(!item.id)throw new Error('PDF保存フォルダの作成を確認できません。');
      return item.id;
    }catch(error){
      if(error instanceof GraphError&&error.status===409){
        const response=await this.graph(path);const item=await response.json() as DriveItem;return item.id;
      }
      throw error;
    }
  }
  private originalName(id:string):string {
    if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('PDFの識別子が不正です。');
    return `${id}.enc`;
  }
  async uploadOriginal(id:string,encrypted:string):Promise<void> {
    const folder=await this.originalsFolder(true);
    if(!folder)throw new Error('PDF保存フォルダがありません。');
    const name=this.originalName(id);
    // Immutable object: existing originals are never overwritten.
    await this.uploadSession(`/me/drive/items/${encodeURIComponent(folder)}:/${name}:/createUploadSession`,new TextEncoder().encode(encrypted));
  }
  async downloadOriginal(id:string):Promise<string> {
    const folder=await this.originalsFolder(false);
    if(!folder)throw new Error('クラウドにPDF原本がありません。');
    const response=await this.graph(`/me/drive/items/${encodeURIComponent(folder)}:/${this.originalName(id)}`);
    const item=await response.json() as DriveItem;
    if(!item.id)throw new Error('PDF原本の参照IDが不正です。');
    return this.downloadItem(item.id,200*1024*1024);
  }

  /**
   * Some Graph/OneDrive responses can advertise HTTP 200 + JSON but contain
   * invalid metadata JSON. Resolve only the named child through the parent's
   * children collection when the direct named-path metadata cannot be parsed.
   * This fallback is READ ONLY; it never creates or modifies anything.
   */
  private async findChildFolderByListing(parent:string,name:string):Promise<string|null> {
    const response=await this.graph(`/me/drive/items/${encodeURIComponent(parent)}/children?$select=id,name,folder&$top=200`);
    let listing:{value?:Array<{id?:unknown;name?:unknown;folder?:unknown}>;'@odata.nextLink'?:unknown};
    try {listing=await response.json() as typeof listing;}
    catch (error) {
      if(error instanceof SyntaxError)throw new Error('OneDriveのフォルダ情報を両方の方法で解析できませんでした。');
      throw error;
    }
    if(!Array.isArray(listing.value))throw new Error('OneDriveのフォルダ一覧の形式が不正です。');
    const folder=listing.value.find(item=>item?.name===name&&typeof item.id==='string'&&item.id.length>0&&item.folder&&typeof item.folder==='object');
    if(folder)return folder.id as string;
    // Never silently treat an incomplete listing as an absent folder.
    if(listing['@odata.nextLink'])throw new Error('OneDriveのフォルダ一覧が200件を超えたため参照できません。');
    return null;
  }

  /** Create/check one folder. Only successful IDs are cached (never a 404). */
  private async childFolder(parent:string,name:string,create:boolean):Promise<string|null> {
    const location=`/me/drive/items/${encodeURIComponent(parent)}:/${encodeURIComponent(name)}`;
    let item:DriveItem|undefined;
    // `:/versions` conflicts with the Microsoft Graph driveItem version-history route.
    // Resolve this particular folder by the parent's children collection, regardless
    // of whether the reserved route returns 200 with a different JSON shape or 400.
    if(name==='versions') {
      const found=await this.findChildFolderByListing(parent,name);
      if(found)item={id:found};
    }else{
      try {
        const response=await this.graph(location);
        try {item=await response.json() as DriveItem;}
        catch(error) {
          if(!(error instanceof SyntaxError))throw error;
          const recovered=await this.findChildFolderByListing(parent,name);
          if(recovered)item={id:recovered};
        }
      }catch(error) {
        if(!(error instanceof GraphError&&error.status===404))throw error;
      }
    }
    if(!item) {
      if(!create)return null;
      try {
        const response=await this.graph(`/me/drive/items/${encodeURIComponent(parent)}/children`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({name,folder:{},'@microsoft.graph.conflictBehavior':'fail'}),
        });
        item=await response.json() as DriveItem;
      }catch(collision) {
        if(!(collision instanceof GraphError&&collision.status===409))throw collision;
        if(name==='versions') {
          const recovered=await this.findChildFolderByListing(parent,name);
          if(!recovered)throw new Error('OneDriveのフォルダ作成結果を確認できません。');
          item={id:recovered};
        } else {
          const response=await this.graph(location);
          try {item=await response.json() as DriveItem;}
          catch(error) {
            if(!(error instanceof SyntaxError))throw error;
            const recovered=await this.findChildFolderByListing(parent,name);
            if(!recovered)throw new Error('OneDriveのフォルダ作成結果を確認できません。');
            item={id:recovered};
          }
        }
      }
    }
    if(!item?.id)throw new Error('OneDriveフォルダの識別子を確認できません。');
    return item.id;
  }

  /** Reuse IDs and coalesce concurrent lookups, without assuming a missing folder exists. */
  private async folderPath(parts: string[], create: boolean): Promise<string | null> {
    let parent=await this.appFolderId();
    let prefix='';
    for(const name of parts) {
      if(!/^[a-z0-9-]{1,64}$/i.test(name))throw new Error('不正なクラウドフォルダ名です。');
      prefix+=`/${name}`;
      const cached=this.directoryIds.get(prefix);
      if(cached){parent=cached;continue;}
      const key=`${prefix}:${create?'create':'read'}`;
      // A concurrent creation is useful to both readers and writers.
      let pending=this.resolvingDirectories.get(create?key:`${prefix}:create`) ?? this.resolvingDirectories.get(key);
      if(!pending){
        pending=this.childFolder(parent,name,create);
        this.resolvingDirectories.set(key,pending);
      }
      let result:string|null;
      try{result=await pending;}finally{
        if(this.resolvingDirectories.get(key)===pending)this.resolvingDirectories.delete(key);
      }
      if(!result)return null;
      this.directoryIds.set(prefix,result);
      parent=result;
    }
    return parent;
  }
  private async readNamedFile(parts:string[],name:string,maxBytes:number):Promise<{text:string;id:string;etag:string}|null> {
    const parent=await this.folderPath(parts,false);
    if(!parent)return null;
    let item:DriveItem;
    try {
      const r=await this.graph(`/me/drive/items/${encodeURIComponent(parent)}:/${encodeURIComponent(name)}`);
      item=await r.json() as DriveItem;
    }catch(error){if(error instanceof GraphError&&error.status===404)return null;throw error;}
    if(!item.id||!item.eTag)throw new Error('OneDriveの更新情報を取得できません。');
    const downloaded=await this.downloadItemInfo(item.id,maxBytes,item);
    return {text:downloaded.text,id:item.id,etag:downloaded.item.eTag??item.eTag};
  }
  private async writeNamedFile(parts:string[],name:string,text:string,existing:{id:string;etag:string}|null,maxBytes:number):Promise<{id:string;etag:string}|null> {
    const bytes=new TextEncoder().encode(text);
    if(!bytes.byteLength||bytes.byteLength>maxBytes)throw new Error('暗号ファイルの容量が不正です。');
    const parent=await this.folderPath(parts,true);
    if(!parent)throw new Error('クラウド保存フォルダを作れませんでした。');
    const path=existing
      ? `/me/drive/items/${encodeURIComponent(existing.id)}/createUploadSession`
      : `/me/drive/items/${encodeURIComponent(parent)}:/${encodeURIComponent(name)}:/createUploadSession`;
    try {
      const result=await this.uploadSession(path,bytes,existing?.etag);
      // Some Graph variants omit ETag on upload completion. The caller will
      // perform a safe read-back only in that case.
      return result.eTag?{id:result.id,etag:result.eTag}:null;
    }catch(error){
      // A folder can be renamed/deleted outside Finance. Next attempt must
      // re-resolve its path rather than keep an invalid directory ID.
      if(error instanceof GraphError&&error.status===404)this.clearDirectoryCache();
      throw error;
    }
  }
  /** finance/index.enc contains only encrypted shard discovery metadata. */
  async readFinanceIndex():Promise<{text:string;id:string;etag:string}|null> {
    return this.readNamedFile([FINANCE_DIR],'index.enc',1_000_000);
  }
  async writeFinanceIndex(text:string,existing:{id:string;etag:string}|null):Promise<void> {
    await this.writeNamedFile([FINANCE_DIR],'index.enc',text,existing,1_000_000);
  }
  /** Independent encrypted merchant display rules, shared across billing years. */
  async readMerchantRules():Promise<{text:string;id:string;etag:string}|null> {
    return this.readNamedFile(this.financeDataPath('rules'),'merchants.enc',2_000_000);
  }
  async writeMerchantRules(text:string,existing:{id:string;etag:string}|null):Promise<{id:string;etag:string}|null> {
    return this.writeNamedFile(this.financeDataPath('rules'),'merchants.enc',text,existing,2_000_000);
  }
  /** Independent encrypted asset settings, never stored in the statement index. */
  async readAssetSettings():Promise<{text:string;id:string;etag:string}|null> {
    return this.readNamedFile(this.financeDataPath('settings'),'assets.enc',2_000_000);
  }
  async writeAssetSettings(text:string,existing:{id:string;etag:string}|null):Promise<{id:string;etag:string}|null> {
    return this.writeNamedFile(this.financeDataPath('settings'),'assets.enc',text,existing,2_000_000);
  }
  /** One listing provides both year discovery and ETags, so unchanged years need no download. */
  async listYearFiles():Promise<Array<{year:string;id:string;etag:string}>> {
    const parent=await this.folderPath(this.financeDataPath('statements'),false);
    if(!parent)return [];
    const r=await this.graph(`/me/drive/items/${encodeURIComponent(parent)}/children?$select=id,name,eTag&$top=400`);
    const json=await r.json() as {value?:DriveItem[];'@odata.nextLink'?:string};
    if(json['@odata.nextLink'])throw new Error('保存年度が多すぎるため一覧を取得できません。');
    if(!Array.isArray(json.value))throw new Error('年別明細の一覧が不正です。');
    return json.value.filter(x=>/^(19|20|21)\d\d\.enc$|^undated\.enc$/.test(x.name??''))
      .map(x=>({year:checkBucket(x.name!.slice(0,-4)),id:x.id,etag:x.eTag??''}));
  }
  async listYearBuckets():Promise<string[]> {return (await this.listYearFiles()).map(x=>x.year);}

  /** Each year is independently encrypted and concurrency-controlled. */
  async readYearVault(year:string):Promise<{text:string;id:string;etag:string}|null> {
    return this.readNamedFile(this.financeDataPath('statements'),`${checkBucket(year)}.enc`,25_000_000);
  }
  /** Before a save, ask only for metadata if our existing decrypted year is current.
   * Microsoft Graph 304 avoids downloading and decrypting an unchanged shard.
   * If the file changed, download it and preserve its actual server ETag. */
  async readYearVaultForSave(year:string,known:{id:string;etag:string}|null):Promise<
    {kind:'unchanged'} | {kind:'remote';file:{text:string;id:string;etag:string}|null}
  > {
    checkBucket(year);
    if(!known?.id||!known.etag)return {kind:'remote',file:await this.readYearVault(year)};
    let response:Response;
    try {
      response=await this.graph(`/me/drive/items/${encodeURIComponent(known.id)}`,{
        headers:{'If-None-Match':known.etag},
      },true);
    }catch(error){
      if(error instanceof GraphError&&error.status===404) {
        // A file may have been replaced with a different drive ID.
        return {kind:'remote',file:await this.readYearVault(year)};
      }
      throw error;
    }
    if(response.status===304)return {kind:'unchanged'};
    const item=await response.json() as DriveItem;
    if(!item.id||!item.eTag)throw new Error('年別ファイルの更新情報が不正です。');
    if(item.id===known.id&&item.eTag===known.etag)return {kind:'unchanged'};
    const downloaded=await this.downloadItemInfo(item.id,25_000_000,item);
    if(!downloaded.item.eTag)throw new Error('年別ファイルのETagを取得できません。');
    return {kind:'remote',file:{text:downloaded.text,id:item.id,etag:downloaded.item.eTag}};
  }

  async writeYearVault(year:string,text:string,existing:{id:string;etag:string}|null):Promise<{id:string;etag:string}|null> {
    return this.writeNamedFile(this.financeDataPath('statements'),`${checkBucket(year)}.enc`,text,existing,25_000_000);
  }
  /** Read a shard via the ID already returned by the year listing. */
  async readListedYearVault(file:{year:string;id:string;etag:string}):Promise<{text:string;id:string;etag:string}> {
    checkBucket(file.year);
    if(!file.id)throw new Error('年別ファイルの識別子が不正です。');
    const value=await this.downloadItemInfo(file.id,25_000_000);
    if(!value.item.eTag)throw new Error('年別ファイルのETagを取得できません。');
    return {text:value.text,id:file.id,etag:value.item.eTag};
  }
  /** PDF originals are immutable; only the encrypted original bytes are uploaded. */
  async uploadDatedOriginal(id:string,encrypted:string,billingMonth:string|null|undefined):Promise<void> {
    const [year,month]=originalParts(billingMonth);checkOriginalMonth(month);
    await this.writeNamedFile(this.financeDataPath('originals',year,month),this.originalName(id),encrypted,null,200*1024*1024);
  }
  async downloadDatedOriginal(id:string,billingMonth:string|null|undefined):Promise<string> {
    const [year,month]=originalParts(billingMonth);checkOriginalMonth(month);
    const file=await this.readNamedFile(this.financeDataPath('originals',year,month),this.originalName(id),200*1024*1024);
    if(!file)throw new Error('指定年月に暗号化PDF原本が見つかりません。');
    return file.text;
  }
  /** Finance may READ Payroll's published income data, never mutate its namespace. */
  async readPayrollPublishedFile(folder:readonly string[],name:string,maxBytes:number):Promise<{text:string;id:string;etag:string}|null> {
    if(folder.length>4||folder.some(part=>!(/^[a-z0-9-]{1,64}$/i.test(part)))||
       !(['index.enc'].includes(name)||/^(19|20|21)\d{2}\.enc$/.test(name))||
       !Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>30_000_000)
      throw new Error('Payroll参照パスが不正です。');
    if(folder.length===0 && name!=='index.enc')throw new Error('Payroll参照パスが不正です。');
    if(folder.length>0 && name==='index.enc')throw new Error('Payroll参照パスが不正です。');
    if(folder.length>0 && !(folder.length===1&&folder[0]==='income') &&
       !(folder.length===3&&folder[0]==='versions'&&folder[2]==='income'&&/^[0-9a-f-]{36}$/i.test(folder[1]!)))
      throw new Error('Payroll参照先は収入公開ファイルに限定されています。');
    return this.readNamedFile([PAYROLL_DIR,...folder],name,maxBytes);
  }
  /** Pre-create the namespace reserved for Payroll, without writing any payroll data. */
  async ensurePayrollNamespace():Promise<void> {await this.folderPath([PAYROLL_DIR],true);}

  async appFolderId(): Promise<string> {
    if(!this.appRoot){
      this.appRoot=(async()=>{
        const response=await this.graph('/me/drive/special/approot');
        const folder=await response.json() as DriveItem;
        if(!folder.id)throw new Error('OneDriveのアプリ専用領域を取得できませんでした。');
        return folder.id;
      })();
    }
    try{return await this.appRoot;}catch(error){this.appRoot=null;throw error;}
  }
  async uploadEncryptedProbe(encrypted: string): Promise<void> {
    if (encrypted.length > 24000) throw new Error('テストファイルのサイズが不正です。');
    const folderId = await this.appFolderId();
    const path = `/me/drive/items/${encodeURIComponent(folderId)}:/${PROBE_FILE_NAME}:/content`;
    await this.graph(path, { method:'PUT', headers: { 'Content-Type':'application/octet-stream' }, body: encrypted });
  }
  async downloadEncryptedProbe(): Promise<string> {
    const folderId = await this.appFolderId();
    const path = `/me/drive/items/${encodeURIComponent(folderId)}:/${PROBE_FILE_NAME}`;
    const response = await this.graph(path);
    const item = await response.json() as DriveItem;
    let downloadUrl = item['@microsoft.graph.downloadUrl'];
    if (!downloadUrl && item.id) {
      const metadataResponse = await this.graph(`/me/drive/items/${encodeURIComponent(item.id)}`);
      const metadata = await metadataResponse.json() as DriveItem;
      downloadUrl = metadata['@microsoft.graph.downloadUrl'];
    }
    if (!downloadUrl || new URL(downloadUrl).protocol !== 'https:') throw new Error('安全なダウンロードURLを取得できませんでした。');
    // The preauthenticated URL MUST NOT receive a Bearer token. Avoid /content's CORS-hostile 302.
    const file = await this.http(downloadUrl, { method: 'GET', credentials: 'omit' });
    if (!file.ok) throw new Error(`暗号化テストファイルの取得に失敗しました (HTTP ${file.status})。`);
    if (Number(file.headers.get('Content-Length') ?? 0) > 24000) throw new Error('取得したファイルが大きすぎます。');
    const text = await file.text();
    if (text.length > 24000) throw new Error('取得したファイルが大きすぎます。');
    return text;
  }
}
