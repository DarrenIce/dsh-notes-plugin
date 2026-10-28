import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const SKILL_NAME = 'write-notes-like-deepseek';
export const PROVIDER_NAME = 'dsh-write-notes';
export const BUNDLED_RANK = 600; // @deepseek-ai/dsh-skill's public BUNDLED_SKILL_RANK

function parse(raw: string) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
  if (!front) throw new Error('DSH notes skill has no frontmatter');
  const description = /^description:\s*(.+)$/m.exec(front[1])?.[1]?.trim();
  if (!description) throw new Error('DSH notes skill has no description');
  return { description, content: raw.slice(front[0].length).trim() };
}

/** Install in the unscoped plugin context; the registry owns effect disposal. */
export function installSkillProvider(ctx: any, skillRoot: string): () => void {
  if (!path.isAbsolute(skillRoot)) throw new Error('skillRoot must be an absolute resource directory');
  const locator = path.join(skillRoot, 'SKILL.md');
  const { description } = parse(readFileSync(locator, 'utf8'));
  const candidate = {
    name: SKILL_NAME, description, invocation: { modelInvocable: true, userInvocable: true },
    provider: PROVIDER_NAME, source: 'bundled', rank: BUNDLED_RANK,
    resourceBase: { kind: 'directory', path: skillRoot.split(path.sep).join('/') }, locator,
  };
  return ctx.skills.registerProvider(() => ({
    name: PROVIDER_NAME,
    async list() { return [candidate]; },
    async get(selected: typeof candidate, options: { signal?: AbortSignal }) {
      const { rank: _rank, locator: file, ...summary } = selected;
      const { content } = parse(await readFile(file, { encoding: 'utf8', signal: options.signal }));
      return { ...summary, content };
    },
  }));
}
