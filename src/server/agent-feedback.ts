import { NOTE_POLICY, NOTE_SECTION } from './prompt-policy.js';
import { PROVIDER_NAME, SKILL_NAME } from './skill-provider.js';

/** Observe this agent's effective registry view, never infer it from a parent transcript. */
export async function agentCompatibility(ctx: any, agent: any, signal: AbortSignal) {
  const result: Record<string, unknown> = {
    scope: 'calling-agent', skill: { status: 'unknown' }, skillTool: 'unknown', prompt: 'unknown',
    childCoverage: '此结果仅描述当前 agent；进程内 spawn/fork 的覆盖需在子 agent 自身检查。',
  };
  try {
    const cwd = await ctx.workingDirectory.ensure(agent, signal);
    const snapshot = await ctx.skills.snapshot({ cwd, scope: agent, signal });
    const winner = snapshot.skills.find((entry: any) => entry.name === SKILL_NAME);
    result.skill = { complete: snapshot.complete, cwd, winner: winner ?? null,
      providerMatches: winner ? winner.provider === PROVIDER_NAME : false };
  } catch (error) { signal.throwIfAborted(); result.skill = { status: 'unknown', reason: String(error) }; }
  try { result.skillTool = ctx.tools.get('skill', agent) ? 'registered-in-scope' : 'not-visible'; }
  catch (error) { result.skillTool = { status: 'unknown', reason: String(error) }; }
  try {
    const assembly = await ctx.systemPrompt.assemble({ scope: agent, signal });
    const section = assembly.sections.find((entry: any) => entry.name === NOTE_SECTION);
    result.prompt = section?.text === NOTE_POLICY ? 'present' : section ? 'shadowed-or-modified' : 'absent';
    result.promptDetail = '实际组装结果；section 缺失可能来自 complete prompt 或其他组装规则。';
  } catch (error) { signal.throwIfAborted(); result.prompt = { status: 'unknown', reason: String(error) }; }
  signal.throwIfAborted();
  return result;
}
