export type BoardView = 'overview' | 'timeline' | 'pitfalls' | 'directory';
export interface BrowseState {
  view: BoardView; query: string; altQuery: string; status: string; category: string; sort: string;
  month: string; timelineCategory: string; selected: string | null; scroll: number; readerScroll: number;
  configIdentity: string | null;
}
const sessions = new Map<string, BrowseState>();
export function defaultBrowseState(): BrowseState {
  return { view: 'overview', query: '', altQuery: '', status: '', category: '', sort: 'new', month: '', timelineCategory: '', selected: null, scroll: 0, readerScroll: 0, configIdentity: null };
}
export function getBrowseState(sessionId: string): BrowseState { return { ...(sessions.get(sessionId) || defaultBrowseState()) }; }
export function saveBrowseState(sessionId: string, state: BrowseState): void { sessions.set(sessionId, { ...state }); }
