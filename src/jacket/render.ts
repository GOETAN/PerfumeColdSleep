import { getBackground } from './background';
import { H, W } from './geometry';
import { FONT_FAMILY, WEIGHTS, drawLabel, type JacketModel, type TextBox } from './label';

/**
 * 描く文字すべてについて Web フォントの読み込みを待つ。
 * 日本語フォントは unicode-range で細かく分割されているので、実際に描く文字列を
 * 渡して必要な分割ファイルを読ませる。1つでも失敗したら例外にして、
 * フォールバックフォントのまま出力されないようにする。
 */
export async function ensureFonts(text: string): Promise<void> {
  const sample = text + '0123456789:-… ';
  const results = await Promise.all(WEIGHTS.map((w) => document.fonts.load(`${w} 40px ${FONT_FAMILY}`, sample)));
  const faces = results.flat();
  if (faces.length === 0) throw new Error('フォントが見つかりません');
  const failed = faces.filter((f) => f.status !== 'loaded');
  if (failed.length > 0) throw new Error('フォントの読み込みに失敗しました');
  for (const w of WEIGHTS) {
    if (!document.fonts.check(`${w} 40px ${FONT_FAMILY}`, sample)) throw new Error('フォントの読み込みが完了していません');
  }
}

export function modelText(model: JacketModel): string {
  return [model.title, model.subtitle, model.total, model.date, ...model.tracks.map((t) => t.title), 'TRACKS TOTAL DATE NOT FOR SALE UNOFFICIAL FAN MADE'].join('');
}

/** フォントを待ってから canvas 全体を描き直す。描いた文字の記録を返す。 */
export async function renderJacket(canvas: HTMLCanvasElement, model: JacketModel): Promise<TextBox[]> {
  await ensureFonts(modelText(model));
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(getBackground(), 0, 0);
  return drawLabel(ctx, model);
}
