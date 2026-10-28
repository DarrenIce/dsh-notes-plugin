export const NOTE_SECTION = 'dsh-write-notes:policy';
export const NOTE_POLICY = '非平凡改动前调用 skill 加载 write-notes-like-deepseek，并调用 notes_context 取得项目笔记根；先检索相关决策，用 notes_begin_review 开始检查区间，按已授权任务维护笔记，收尾用 notes_validate 检查最新结果。纯机械改动跳过。用户指令和项目约束优先。';

export function installPromptPolicy(ctx: any): () => void {
  return ctx.systemPrompt.section({ name: NOTE_SECTION, order: 550, text: NOTE_POLICY, interpolate: false });
}
