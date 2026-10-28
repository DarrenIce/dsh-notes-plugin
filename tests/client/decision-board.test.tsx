import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DecisionBoard } from '../../src/client/decision-board';
import { defaultBrowseState, getBrowseState, saveBrowseState } from '../../src/client/board-store';

test('native board filters, reads safely and retains independent session views', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://local.test' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const data = { status: 'ready' as const, configRevision: 'r', complete: true, notes: [
    { id: 'implemented/feature/a.md', raw: '# Agent Note: Alpha\n\n## Decision\n<img src=x onerror=alert(1)>\n[恶意](javascript:alert(1))\n[关联](b.md)' },
    { id: 'implemented/feature/b.md', raw: '# Agent Note: Beta\n\n## Decision\n安全' },
    { id: 'rejected/testing/b.md', raw: '# Agent Note: Other\n\n## Problem\n失败' },
  ] };
  const render = async (sessionId: string) => { await act(async () => root.render(<DecisionBoard sessionId={sessionId} snapshot={data} />)); };
  const button = (text: string) => [...document.querySelectorAll('button')].find(el => el.textContent?.includes(text)) as HTMLButtonElement;
  await render('one');
  await act(async () => button('文档目录').click());
  assert.match(document.body.textContent!, /匹配 3 条/);
  await act(async () => button('Alpha').click());
  assert.equal(document.querySelector('.dnb-reader img'), null);
  assert.equal(document.querySelector('.dnb-reader a[href^="javascript:"]'), null);
  assert.match(document.querySelector('.dnb-reader')!.textContent!, /<img src=x onerror=alert\(1\)>/);
  await act(async () => button('关联').click());
  assert.match(document.querySelector('.dnb-reader')!.textContent!, /Beta/);
  await render('two');
  assert.equal(document.querySelector('.dnb-reader'), null);
  assert.equal(button('总览').getAttribute('aria-pressed'), 'true');
  await render('one');
  assert.match(document.querySelector('.dnb-reader')!.textContent!, /Beta/);
  await act(async () => root.unmount());
  dom.window.close();
});

test('restores saved reading and scroll only after the same root is ready', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://local.test' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const id = 'implemented/feature/a.md';
  saveBrowseState('saved', { ...defaultBrowseState(), view: 'directory', configIdentity: 'root-a', selected: id, scroll: 80, readerScroll: 42 });
  const loading = { status: 'loading' as const, configRevision: '', notes: [] };
  const ready = { status: 'ready' as const, configRevision: 'r', configIdentity: 'root-a', complete: true, notes: [{ id, raw: '# Agent Note: Alpha' }] };
  await act(async () => root.render(<DecisionBoard sessionId="saved" snapshot={loading} />));
  const board = document.querySelector('.dnb')!;
  await act(async () => board.dispatchEvent(new dom.window.Event('scroll')));
  assert.equal(getBrowseState('saved').scroll, 80);
  assert.equal(getBrowseState('saved').selected, id);
  await act(async () => root.render(<DecisionBoard sessionId="saved" snapshot={ready} />));
  assert.match(document.querySelector('.dnb-reader')!.textContent!, /Alpha/);
  assert.equal((document.querySelector('.dnb-reader') as HTMLElement).scrollTop, 42);
  assert.equal((document.querySelector('.dnb') as HTMLElement).scrollTop, 80);
  await act(async () => root.render(<DecisionBoard sessionId="saved" snapshot={{ ...ready, configIdentity: 'root-b' }} />));
  assert.equal(document.querySelector('.dnb-reader'), null);
  assert.equal(getBrowseState('saved').selected, null);
  assert.equal(getBrowseState('saved').readerScroll, 0);
  assert.equal(getBrowseState('saved').configIdentity, 'root-b');
  saveBrowseState('deleted', { ...defaultBrowseState(), configIdentity: 'root-a', selected: id, readerScroll: 42 });
  await act(async () => root.render(<DecisionBoard sessionId="deleted" snapshot={{ ...ready, notes: [] }} />));
  assert.equal(getBrowseState('deleted').selected, null);
  assert.equal(getBrowseState('deleted').readerScroll, 0);
  await act(async () => root.unmount());
  dom.window.close();
});
