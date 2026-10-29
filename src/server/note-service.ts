import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkspaceContext } from '../contracts/workspace.js';
import { NotesError } from '../contracts/workspace.js';
import type { Note, NoteSnapshot, NoteDocument, NotesChange } from '../contracts/notes.js';
import { scanNotes, validateNotes } from '../../skills/write-notes-like-deepseek/scripts/lib/index.ts';
import { WorkspaceResolver, confinedPath } from './workspace-context.js';
import { NoteWatch } from './note-watch.js';
import { captureNotes } from './scan-integrity.js';
import { ValidationService } from './validation-service.js';
const exec = promisify(execFile);
interface Entry {
  key: string; context: WorkspaceContext; snapshot?: NoteSnapshot; pending?: Promise<NoteSnapshot>;
  watch?: NoteWatch; consumers: Map<symbol, {sid:string; callback:(event:NotesChange)=>void}>;
  disposed: boolean; timer?: ReturnType<typeof setTimeout>; reviewUntil: number;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function checkoutVersion(root: string): Promise<string> {
  const options = {timeout:3000,maxBuffer:8192,env:{...process.env,LC_ALL:'C'}};
  try {
    const head = (await exec('git',['-C',root,'rev-parse','--verify','HEAD'],options)).stdout.trim();
    let branch = 'detached';
    try { branch = (await exec('git',['-C',root,'symbolic-ref','--quiet','HEAD'],options)).stdout.trim(); } catch { /* detached */ }
    return `${branch}:${head}`;
  } catch (error) {
    const message = String((error as {stderr?:string}).stderr ?? '');
    if (/not a git repository/.test(message)) return 'no-git';
    try {
      if ((await exec('git',['-C',root,'rev-parse','--is-inside-work-tree'],options)).stdout.trim() === 'true') {
        const branch = (await exec('git',['-C',root,'symbolic-ref','--quiet','HEAD'],options)).stdout.trim();
        return `unborn:${branch}`;
      }
    } catch { /* distinguish a known empty repository from unavailable Git metadata */ }
    return 'unknown';
  }
}
/** Shared per-root snapshots; every public request rechecks the session's immutable workspace identity. */
export class NotesService {
  private entries = new Map<string,Entry>();
  private version = 0;
  private closed = false;
  private reviews = new Map<string,{sid:string;key:string;sourceVersion:string;expires:number}>();
  private stopConfig: () => void;
  readonly validator = new ValidationService();
  constructor(readonly resolver: WorkspaceResolver) {
    this.stopConfig = resolver.configuration.subscribe(() => {
      for (const entry of [...this.entries.values()]) {
        for (const consumer of entry.consumers.values()) this.deliver(consumer.callback,{type:'invalidated',message:'笔记目录配置已变更，请重新同步。'});
        this.release(entry);
      }
      this.reviews.clear(); this.validator.dispose();
    });
  }
  private key(context: WorkspaceContext) { return JSON.stringify([context.workspaceId,context.projectRoot,context.notesRoot,context.configRevision]); }
  private async entry(sid: string) {
    if (this.closed) throw new NotesError('disposed','决策笔记插件已停用。');
    const context = await this.resolver.resolve(sid); const key = this.key(context);
    if (this.closed) throw new NotesError('disposed','决策笔记插件已停用。');
    if (context.configRevision !== this.resolver.configuration.revisionFor(context.workspaceId)) throw new NotesError('stale-config','笔记目录配置已变更。');
    let entry = this.entries.get(key);
    if (!entry) { entry = {key,context,consumers:new Map(),disposed:false,reviewUntil:0}; this.entries.set(key,entry); }
    if (entry.timer) clearTimeout(entry.timer);
    entry.context = context;
    return entry;
  }
  private arm(entry: Entry) {
    if (entry.disposed) return;
    if (entry.consumers.size || entry.reviewUntil > Date.now()) {
      entry.watch ??= new NoteWatch(entry.context.notesRoot,()=>{ void this.refresh(entry).catch(()=>{}); },this.resolver.configuration.pollIntervalMs);
      return;
    }
    entry.watch?.close(); entry.watch = undefined;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(()=>this.release(entry),10000); entry.timer.unref();
  }
  private release(entry: Entry) {
    entry.disposed = true; entry.watch?.close(); if (entry.timer) clearTimeout(entry.timer);
    entry.consumers.clear(); this.entries.delete(entry.key);
  }
  private deliver(callback: (event:NotesChange)=>void, event: NotesChange) { try { callback(event); } catch { /* consumer failure must not poison scans */ } }
  private async refresh(entry: Entry): Promise<NoteSnapshot> {
    if (entry.pending) return entry.pending;
    entry.pending = this.scan(entry).finally(()=>{ entry.pending = undefined; this.arm(entry); });
    return entry.pending;
  }
  private async scan(entry: Entry): Promise<NoteSnapshot> {
    const context = entry.context;
    let notes: Note[] = []; let core: ReturnType<typeof validateNotes>;
    let status: NoteSnapshot['status'] = 'ready'; let message: string | undefined;
    const checkout = await checkoutVersion(context.projectRoot);
    let captured: Awaited<ReturnType<typeof captureNotes>> | undefined;
    let fingerprint = '';
    try {
      await confinedPath(context.projectRoot,context.notesRoot);
      captured = await captureNotes(context);
      fingerprint = captured.fingerprint;
      status = captured.status;
      const notesBefore = scanNotes(captured.root).notes as Note[];
      if (notesBefore.length > 5000) throw new NotesError('scan-limit','笔记数量超过单次扫描上限。');
      let baselineRaw: string | null = null;
      if (checkout !== 'no-git' && checkout !== 'unknown' && !checkout.startsWith('unborn:')) {
        try {
          const options = {timeout:3000,maxBuffer:4*1024*1024,env:{...process.env,LC_ALL:'C'}};
          const prefix = (await exec('git',['-C',context.projectRoot,'rev-parse','--show-prefix'],options)).stdout.replace(/\r?\n$/, '');
          baselineRaw = (await exec('git',['-C',context.projectRoot,'show',`HEAD:${prefix}${context.notesPath}/archived/manifest.json`],options)).stdout;
        }
        catch (error) {
          if (!/does not exist|exists on disk, but not in|does not exist in/.test(String((error as {stderr?:string}).stderr ?? ''))) throw new NotesError('baseline-unavailable','无法读取 Git 归档基线。');
        }
      }
      core = validateNotes(captured.root,{archiveBaseline:{raw:baselineRaw,ref:'HEAD',warnings:checkout==='no-git'?['not a git repository — append-only check skipped (seal hashes still verified against disk)']:[]}});
      notes = notesBefore;
      const finalCheckout = await checkoutVersion(context.projectRoot);
      const finalCapture = await captureNotes(context,false);
      let stable: boolean;
      try { stable = fingerprint === finalCapture.fingerprint && checkout === finalCheckout; }
      finally { finalCapture.dispose(); }
      if (!stable || checkout === 'unknown') { core = {...core,complete:false}; message = '捕获期间文档或 Git 状态发生变化，等待下一次完整同步。'; }
    } catch (error) {
      status = 'error'; message = error instanceof Error ? error.message : String(error); notes = [];
      core = {issues:[{rule:'scan-error',path:'',anchor:'scan',message}],warnings:[],complete:false};
    } finally { captured?.dispose(); }
    if (entry.disposed || this.closed) throw new NotesError('stale-snapshot','已取消旧目录扫描。');
    const sourceVersion = hash([notes,core,status,checkout,fingerprint]);
    const unchanged = entry.snapshot?.sourceVersion === sourceVersion;
    const snapshotVersion = unchanged ? entry.snapshot!.snapshotVersion : ++this.version;
    const validation = this.validator.build(context,snapshotVersion,sourceVersion,core);
    const snapshot: NoteSnapshot = {workspaceId:context.workspaceId,projectRoot:context.projectRoot,notesRoot:context.notesRoot,
      configRevision:context.configRevision,snapshotVersion,sourceVersion,checkoutVersion:checkout,complete:core.complete,
      status,message,notes,validation};
    entry.snapshot = snapshot;
    for (const [id,consumer] of entry.consumers) {
      try {
        const current = await this.resolver.resolve(consumer.sid);
        if (entry.disposed) break;
        if (this.key(current) !== entry.key) {
          this.deliver(consumer.callback,{type:'invalidated',message:'会话工作区已变更，请重新同步。'}); entry.consumers.delete(id);
        } else this.deliver(consumer.callback,{type:'snapshot',snapshot});
      } catch (error) {
        this.deliver(consumer.callback,{type:'error',message:error instanceof Error?error.message:String(error)}); entry.consumers.delete(id);
      }
    }
    return snapshot;
  }
  private async assertCurrent(sid: string, expected: WorkspaceContext) {
    if (this.closed) throw new NotesError('disposed','决策笔记插件已停用。');
    const current = await this.resolver.resolve(sid);
    if (this.closed) throw new NotesError('disposed','决策笔记插件已停用。');
    if (this.key(current) !== this.key(expected)) throw new NotesError('stale-context','请求期间会话或笔记目录发生变化，请重试。');
    return current;
  }
  async snapshot(sid: string): Promise<NoteSnapshot> {
    const entry = await this.entry(sid); const expected = entry.context;
    try {
      if (entry.pending) await entry.pending;
      const snapshot = await this.refresh(entry);
      await this.assertCurrent(sid,expected);
      if (entry.disposed) throw new NotesError('stale-context','旧笔记目录已失效。');
      return snapshot;
    } finally { this.arm(entry); }
  }
  async read(sid: string,id: string): Promise<NoteDocument> {
    if (typeof id !== 'string' || id.length > 2048 || id.includes('\\') || id.split('/').some(part=>part==='..') || id.startsWith('/')) throw new NotesError('invalid-path','无效笔记路径。');
    const expected = await this.resolver.resolve(sid); const snapshot = await this.snapshot(sid);
    const context = await this.assertCurrent(sid,expected);
    if (snapshot.workspaceId !== context.workspaceId || snapshot.notesRoot !== context.notesRoot || snapshot.configRevision !== context.configRevision) throw new NotesError('stale-context','正文与会话上下文不一致。');
    const note = snapshot.notes.find(note=>note.id===id);
    if (!snapshot.complete || !note) throw new NotesError('note-unavailable','笔记不存在或尚未取得完整快照。');
    return {id,raw:note.rawBody,context,snapshotVersion:snapshot.snapshotVersion,sourceVersion:snapshot.sourceVersion};
  }
  async subscribe(sid: string, callback: (event: NotesChange)=>void): Promise<()=>void> {
    const entry = await this.entry(sid); const id = Symbol(sid);
    entry.consumers.set(id,{sid,callback}); this.arm(entry);
    try { const snapshot = await this.refresh(entry); if (entry.consumers.has(id)) this.deliver(callback,{type:'snapshot',snapshot}); }
    catch (error) { entry.consumers.delete(id); this.arm(entry); throw error; }
    return () => { entry.consumers.delete(id); this.arm(entry); };
  }
  async beginReview(sid: string) {
    const snapshot = await this.snapshot(sid);
    const entry = await this.entry(sid);
    if (snapshot.workspaceId !== entry.context.workspaceId || snapshot.notesRoot !== entry.context.notesRoot || snapshot.configRevision !== entry.context.configRevision) throw new NotesError('stale-context','检查起点已失效。');
    await this.assertCurrent(sid,entry.context);
    const result = this.validator.beginReview(sid,snapshot);
    const expires = Date.parse(result.expiresAt);
    this.reviews.set(result.reviewToken,{sid,key:entry.key,sourceVersion:snapshot.sourceVersion,expires});
    entry.reviewUntil = Math.max(entry.reviewUntil,expires); this.arm(entry);
    return result;
  }
  async validation(sid: string, token?: string) {
    const snapshot = await this.snapshot(sid);
    for (const [id,review] of this.reviews) if(review.expires<=Date.now())this.reviews.delete(id);
    const review = token ? this.reviews.get(token) : undefined;
    const overlap = review && [...this.reviews.values()].some(other=>other!==review && other.key===review.key);
    // Ordinary file tools and external editors carry no verifiable authorship evidence.
    const concurrent = !!review && (!!overlap || review.sourceVersion!==snapshot.sourceVersion);
    return this.validator.classify(sid,token,snapshot,{concurrent});
  }
  get diagnostics() { return {entries:this.entries.size,watchers:[...this.entries.values()].reduce((sum,e)=>sum+(e.watch?.count??0),0),consumers:[...this.entries.values()].reduce((sum,e)=>sum+e.consumers.size,0)}; }
  dispose() { if(this.closed)return; this.closed=true; this.stopConfig(); for(const entry of [...this.entries.values()])this.release(entry); this.reviews.clear(); this.validator.dispose(); }
}
