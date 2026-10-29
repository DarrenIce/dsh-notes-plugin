import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {captureNotes} from '../../src/server/scan-integrity.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {WorkspaceResolver} from '../../src/server/workspace-context.ts';

const supported = {skip: !['linux','win32'].includes(process.platform)};
async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'notes-capture-'));
  const project = await fs.realpath(temporary);
  const resolver = new WorkspaceResolver({header:async()=>({cwd:project}),workspaces:()=>[]});
  return {project,resolver,async cleanup(){
    assert.equal(path.dirname(project),await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(project).startsWith('notes-capture-'));
    await fs.rm(project,{recursive:true,force:true});
  }};
}

test('capture preserves Unicode paths and bytes, fingerprints empty directories, and releases handles',supported,async()=>{
  const f = await fixture();
  try {
    const context = await f.resolver.resolve('s');
    const id = 'implemented/feature/2026-10-29-中文 空格.md';
    const target = path.join(context.notesRoot,id);
    await fs.mkdir(path.dirname(target),{recursive:true});
    const content = Buffer.from('# 中文笔记\r\n\r\nStatus: implemented\r\n','utf8');
    await fs.writeFile(target,content);
    const first = await captureNotes(context);
    let fingerprint: string;
    try {
      assert.equal(first.status,'ready');
      assert.deepEqual(await fs.readFile(path.join(first.root,id)),content);
      fingerprint = first.fingerprint;
    } finally { first.dispose(); }
    const stable = await captureNotes(context,false);
    try { assert.equal(stable.root,'');assert.equal(stable.fingerprint,fingerprint); } finally { stable.dispose(); }
    await fs.mkdir(path.join(context.notesRoot,'empty'));
    const changed = await captureNotes(context,false);
    try { assert.notEqual(changed.fingerprint,fingerprint); } finally { changed.dispose(); }
    // Windows cannot rename these paths if the helper leaked a no-delete-share handle.
    await fs.rename(target,`${target}.moved`);
    await fs.rename(context.notesRoot,`${context.notesRoot}-moved`);
  } finally { await f.cleanup(); }
});

test('missing capture remains a complete empty input without creating project directories',supported,async()=>{
  const f = await fixture();
  try {
    const context = await f.resolver.resolve('s');
    const captured = await captureNotes(context);
    try { assert.equal(captured.status,'missing');assert.deepEqual(await fs.readdir(captured.root),[]); }
    finally { captured.dispose(); }
    await assert.rejects(fs.stat(context.notesRoot),{code:'ENOENT'});
  } finally { await f.cleanup(); }
});

test('capture refuses directory junctions and file symlinks without exposing external content',supported,async()=>{
  const f = await fixture();
  try {
    const context = await f.resolver.resolve('s');
    await fs.mkdir(context.notesRoot,{recursive:true});
    const outside = path.join(f.project,'outside');await fs.mkdir(outside);
    await fs.writeFile(path.join(outside,'secret.md'),'outside-secret');
    const link = path.join(context.notesRoot,'link');
    const rejectsLink = (error: unknown) => (error as {code?:string})?.code === 'symlink' || /symlink|reparse|ELOOP|ENOTDIR/.test(String(error));
    await fs.symlink(outside,link,process.platform==='win32'?'junction':'dir');
    await assert.rejects(captureNotes(context),rejectsLink);
    await fs.unlink(link);
    await fs.symlink(path.join(outside,'secret.md'),link,'file');
    await assert.rejects(captureNotes(context),rejectsLink);
    await fs.unlink(link);
    const valid = await captureNotes(context,false);valid.dispose();
  } finally { await f.cleanup(); }
});

test('capture rejects an oversized file and releases handles after failure',supported,async()=>{
  const f = await fixture();
  try {
    const context = await f.resolver.resolve('s');
    await fs.mkdir(context.notesRoot,{recursive:true});
    const file = path.join(context.notesRoot,'oversized.md');
    await fs.writeFile(file,Buffer.alloc(4*1024*1024+1));
    await assert.rejects(captureNotes(context),/scan-limit|读取上限/);
    await fs.rename(file,`${file}.moved`);
    await fs.rename(context.notesRoot,`${context.notesRoot}-moved`);
  } finally { await f.cleanup(); }
});

test('Windows pinned directories reject write handles required for in-place junction conversion', {skip:process.platform!=='win32'}, async()=>{
  const f = await fixture();
  try {
    const script = path.join(f.project,'probe.ps1');
    await fs.writeFile(script,`param([string]$CaptureScript,[string]$Project)
$ErrorActionPreference = 'Stop'
. $CaptureScript
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class CaptureWriteProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  public static int TryWrite(string path) {
    using(var handle = CreateFileW(path,0x40000000,7,IntPtr.Zero,3,0x2200000,IntPtr.Zero))
      return handle.IsInvalid ? Marshal.GetLastWin32Error() : 0;
  }
}
'@
if ([CaptureWriteProbe]::TryWrite($Project) -ne 0) { throw 'unlocked baseline must allow write access' }
$method = [NotesWindowsCapture].GetMethod('Open', [Reflection.BindingFlags]'NonPublic,Static')
$handle = $method.Invoke($null,[object[]]@($Project,$true,$false))
try {
  if ([CaptureWriteProbe]::TryWrite($Project) -ne 32) { throw 'pinned directory allowed a reparse mutation write handle' }
  $renamed = $false
  try { [IO.Directory]::Move($Project,$Project+'-moved'); $renamed = $true } catch [IO.IOException] { }
  if ($renamed) { throw 'pinned directory allowed rename' }
} finally { $handle.Dispose() }
if ([CaptureWriteProbe]::TryWrite($Project) -ne 0) { throw 'capture leaked a directory handle' }
[Console]::Out.WriteLine('native-lock-ok')
`,'utf8');
    const exec = promisify(execFile);
    const child = exec(path.join(process.env.SystemRoot ?? 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),[
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,
      '-CaptureScript',fileURLToPath(new URL('../../src/server/windows-capture.ps1',import.meta.url)),'-Project',f.project,
    ],{encoding:'utf8',timeout:30000,windowsHide:true});
    child.child.stdin!.end(JSON.stringify({projectRoot:f.project,notesPath:'.agents/notes'}));
    assert.match((await child).stdout,/native-lock-ok/);
  } finally { await f.cleanup(); }
});
