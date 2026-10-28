#!/usr/bin/env node
// Read-only probe; never modifies or connects to the active profile.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
import { readFile } from 'node:fs/promises'

const root = resolve(process.env.DSH_ROOT ?? '/home/darren/.nvm/versions/node/v24.18.0/lib/node_modules/@deepseek-ai/dsh')
const requireHost = createRequire(join(root, 'package.json'))
const load = async name => import(pathToFileURL(requireHost.resolve(name)).href)
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const { Context } = await load('@deepseek-ai/cordis')
const { default: SkillRegistry, BUNDLED_SKILL_RANK } = await load('@deepseek-ai/dsh-skill')
const protocol = await load('@deepseek-ai/dsh-typert-protocol')
const remote = await load('@deepseek-ai/dsh-api-workspace-files/remote')
const workspace = await load('@deepseek-ai/dsh-workspace')
const hostFiles = await load('@deepseek-ai/dsh-api-workspace-files')
const ctx = new Context()
const registry = await ctx.plugin(SkillRegistry)
let control
const provider = await ctx.plugin({ name: 'contract-probe-provider', inject: ['skills'], apply(scope) {
  scope.skills.registerProvider(c => {
    control = c
    return { name: 'contract-probe', async list() { return [{name: 'contract-probe', description: 'Probe', invocation: {modelInvocable: true, userInvocable: true}, source: 'bundled', provider: 'contract-probe', rank: BUNDLED_SKILL_RANK, resourceBase: {kind: 'directory', path: root}, locator: 'probe'}] }, async get(candidate) { const {rank, locator, ...summary} = candidate; return {...summary, content: 'contract probe body'} } }
  })
} })
try {
  const listed = await ctx.skills.list()
  assert.equal(listed.find(x => x.name === 'contract-probe')?.provider, 'contract-probe')
  const skill = await ctx.skills.get('contract-probe')
  assert.equal(skill.content, 'contract probe body')
  assert.equal(skill.resourceBase.path, root)
  assert.equal(control.signal.aborted, false)
  await provider.dispose()
  assert.equal(control.signal.aborted, true)
  assert.equal((await ctx.skills.list()).some(x => x.name === 'contract-probe'), false)
  assert.equal(typeof protocol.TypertRemoteService, 'function')
  assert.equal(typeof protocol.Remote, 'function')
  assert.equal(typeof workspace.WorkspaceRegistry.prototype.list, 'function')
  assert.equal(typeof hostFiles.default.prototype.read, 'function')
  assert.equal(remote.TYPERT_REMOTE.methods['workspaceFiles/changes'].mode, 'stream')
  assert.equal(remote.TYPERT_REMOTE.methods['workspaceFiles/read'].parameters[0].source, 'lookup')
  assert.equal(remote.TYPERT_REMOTE.methods['workspaceFiles/read'].parameters[0].lookup, 'workspaceFileScope')
  const conversation = await readFile(requireHost.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
  assert.match(conversation, /captureInsertion/)
  assert.match(conversation, /conversation\.view/)
  console.log(JSON.stringify({dsh: manifest.version, runtime: process.version, passed: ['real Cordis SkillRegistry provider list/get/resource/disposal', 'installed Typert Remote metadata lookup and stream', 'installed workspace and workspaceFiles service exports', 'client bundle contains conversation.view and captureInsertion'], notTested: ['gateway transport, authorization, errors, cancellation and reconnect', 'workspace/session persistence resolver', 'actual browser view, theme and draft', 'system prompt, tools and child agents', 'running Web profile and GUI']}, null, 2))
} finally {
  await provider.dispose()
  await registry.dispose()
}
