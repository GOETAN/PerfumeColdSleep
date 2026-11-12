import { songById } from './songs';

export const REQUIRED = 13;
const KEY = 'favorites-jacket:v1';

export interface State {
  /** 選んだ曲の id。並び順もこの配列で持つ */
  selected: string[];
  name: string;
  title: string;
  /** タイトルを手で書き換えたか。false の間は名前に合わせて自動で作る */
  titleEdited: boolean;
}

export function defaultTitle(name: string): string {
  return `FAVORITES (Selected by ${name.trim() || '〇〇'})`;
}

export function loadState(): State {
  const state: State = { selected: [], name: '', title: defaultTitle(''), titleEdited: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      if (Array.isArray(saved.selected)) {
        // songs.json を作り直して消えた id は捨てる
        const ids = saved.selected.filter((id: unknown): id is string => typeof id === 'string' && songById.has(id));
        state.selected = [...new Set<string>(ids)].slice(0, REQUIRED);
      }
      if (typeof saved.name === 'string') state.name = saved.name;
      state.titleEdited = saved.titleEdited === true;
      state.title = state.titleEdited && typeof saved.title === 'string' ? saved.title : defaultTitle(state.name);
    }
  } catch {
    // 壊れた保存データやストレージ無効は初期状態で続ける
  }
  return state;
}

export function saveState(state: State): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** 合計時間。時間不明の曲は足さず、その曲数を unknown で返す。 */
export function totalOf(ids: string[]): { text: string; unknown: number } {
  let sec = 0;
  let unknown = 0;
  for (const id of ids) {
    const d = songById.get(id)?.durationSec ?? null;
    if (d === null) unknown++;
    else sec += d;
  }
  return { text: `${Math.floor(sec / 60)}min ${String(sec % 60).padStart(2, '0')}sec`, unknown };
}
