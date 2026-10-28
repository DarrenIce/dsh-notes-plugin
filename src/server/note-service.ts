import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkspaceContext } from '../contracts/workspace.js';
import { NotesError } from '../contracts/workspace.js';
import type { Note, NoteSnapshot, NoteDocument, NotesChange } from '../contracts/notes.js';
import { scanNotes, validateNotes } from '../../skills/write-notes-like-deepseek/scripts/lib/index.ts';
import { WorkspaceResolver, confinedPath } from './workspace-context.js';
import { NoteWatch } from './note-watch.js';
import { scanFingerprint } from './scan-integrity.js';
import { ValidationService } from './validation-service.js';
const exec = promisify(execFile);
interface Entry {
  key: string; context: WorkspaceContext; snapshot?: NoteSnapshot; pending?: Promise<NoteSnapshot>;
  watch?: NoteWatch; consumers: Map<symbol, {sid:string; callback:(event:NotesChange)=>void}>;
  disposed: boolean; timer?: ReturnType<typeof setTimeout>; reviewUntil: number;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function checkoutVersion(root: string): Promise<string> {
  const options = {timeout:3000,maxBuffer:8192};
  try {
    const head = (await exec('git',['-C',root,'rev-parse','--verify','HEAD'],options)).stdout.trim();
    let branch = 'detached';
    try { branch = (await exec('git',['-C',root,'symbolic-ref','--quiet','HEAD'],options)).stdout.trim(); } catch { /* detached */ }
    return `${branch}:${head}`;
  } catch (error) {
    const message = String((error as {stderr?:string}).stderr ?? '');
    return /not a git repository/.test(message) ? 'no-git' : 'unknown';
  }
}
/** Shared per-root snapshots; every public request rechecks the session's immutable workspace identity. */
export class NotesService {
  private entries = new Map<string,Entry>();
  private version = 0;
  private closed = false;
  private stopConfig: () => void;
  readonly validator = new ValidationService();
  constructor(readonly resolver: WorkspaceResolver) {
    this.stopConfig = resolver.configuration.subscribe(() => {
      for (const entry of [...this.entries.values()]) {
        for (const consumer of entry.consumers.values()) this.deliver(consumer.callback,{type:'invalidated',message:'笔记目录配置已变更，请重新同步。'});
        this.release(entry);
      }
      this.validator.dispose();
    });
  }
  private key(context: WorkspaceContext) { return JSON.stringify([context.workspaceId,context.projectRoot,context.notesRoot,context.configRevision]); }
  private async entry(sid: string) {
    if (this.closed) throw new NotesError('disposed','决策笔记插件已停用。');
    const context = await this.resolver.resolve(sid); const key = this.key(context);
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
    try {
      const state = await confinedPath(context.projectRoot,context.notesRoot);
      status = state;
      const fingerprint = scanFingerprint(context.notesRoot);
      const before = scanNotes(context.notesRoot).notes as Note[];
      if (before.length > 5000) throw new NotesError('scan-limit','笔记数量超过单次扫描上限。');
      core = validateNotes(context.notesRoot);
      const after = scanNotes(context.notesRoot).notes as Note[];
      const finalCheckout = await checkoutVersion(context.projectRoot);
      const stable = fingerprint === scanFingerprint(context.notesRoot) && hash(before) === hash(after) && checkout === finalCheckout;
      notes = after;
      if (!stable) { core = {...core,complete:false}; message = '扫描期间文档发生变化，等待下一次完整同步。'; }
    } catch (error) {
      status = 'error'; message = error instanceof Error ? error.message : String(error);
      core = {issues:[{rule:'scan-error',path:'',anchor:'scan',message}],warnings:[],complete:false};
    }
    if (entry.disposed || this.closed) throw new NotesError('stale-snapshot','已取消旧目录扫描。');
    const sourceVersion = hash([notes,core,status,checkout]);
    const unchanged = entry.snapshot?.sourceVersion === sourceVersion;
    const snapshotVersion = unchanged ? entry.snapshot!.snapshotVersion : ++this.version;
    const validation = this.validator.build(context,snapshotVersion,sourceVersion,core);
    const snapshot: NoteSnapshot = unchanged ? entry.snapshot! : {workspaceId:context.workspaceId,projectRoot:context.projectRoot,notesRoot:context.notesRoot,
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
  async snapshot(sid: string): Promise<NoteSnapshot> {
    const entry = await this.entry(sid); try { if (entry.pending) await entry.pending; return await this.refresh(entry); } finally { this.arm(entry); }
  }
  async read(sid: string,id: string): Promise<NoteDocument> {
    if (typeof id !== 'string' || id.length > 2048 || id.includes('\\') || id.split('/').some(part=>part==='..') || id.startsWith('/')) throw new NotesError('invalid-path','无效笔记路径。');
    const context = await this.resolver.resolve(sid); const snapshot = await this.snapshot(sid);
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
    const entry = await this.entry(sid); const snapshot = await this.refresh(entry);
    const result = this.validator.beginReview(sid,snapshot);
    entry.reviewUntil = Math.max(entry.reviewUntil,Date.parse(result.expiresAt)); this.arm(entry);
    return result;
  }
  async validation(sid: string, token?: string) {
    return this.validator.classify(sid,token,await this.snapshot(sid));
  }
  get diagnostics() { return {entries:this.entries.size,watchers:[...this.entries.values()].reduce((sum,e)=>sum+(e.watch?.count??0),0),consumers:[...this.entries.values()].reduce((sum,e)=>sum+e.consumers.size,0)}; }
  dispose() { if(this.closed)return; this.closed=true; this.stopConfig(); for(const entry of [...this.entries.values()])this.release(entry); this.validator.dispose(); }
}
