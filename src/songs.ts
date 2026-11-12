import raw from '../data/songs.json';

export interface Song {
  id: string;
  title: string;
  durationSec: number | null;
  release: string;
  releaseType: 'single' | 'digital-single' | 'ep' | 'album' | 'best' | 'compilation';
  sourceArticle: string;
}

/** 画面での大まかな分類。配信シングルはシングル、ベスト盤・コンピレーションはアルバムに含める。 */
export type Category = 'single' | 'album' | 'other';
export const CATEGORY_LABEL: Record<Category, string> = { single: 'シングル', album: 'アルバム', other: 'その他' };

export function categoryOf(song: Song): Category {
  switch (song.releaseType) {
    case 'single':
    case 'digital-single':
      return 'single';
    case 'album':
    case 'best':
    case 'compilation':
      return 'album';
    default:
      return 'other';
  }
}

export const songs = raw as Song[];
export const songById = new Map(songs.map((s) => [s.id, s]));

/** 検索用: 全角半角・大文字小文字・カタカナ/ひらがな・空白の違いを無視する */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}

const haystack = new Map(songs.map((s) => [s.id, normalize(s.title + ' ' + s.release)]));

export function matches(song: Song, query: string): boolean {
  return haystack.get(song.id)!.includes(query);
}

export function formatDuration(sec: number | null): string {
  return sec === null ? '-:--' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
