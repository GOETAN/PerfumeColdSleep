/** 出力サイズ。参考より少し縦長寄りの比率にしている。 */
export const W = 2048;
export const H = 1776;

export const DISC = { cx: 1270, cy: H / 2, r: 770 };

/** 白ラベル。左端から right まで伸び、右端は半径 = 高さ/2 の半円。 */
const LABEL_TOP = 142;
const LABEL_BOTTOM = 1634;
const LABEL_RIGHT = 1640;
const LABEL_R = (LABEL_BOTTOM - LABEL_TOP) / 2;
export const LABEL = {
  top: LABEL_TOP,
  bottom: LABEL_BOTTOM,
  right: LABEL_RIGHT,
  r: LABEL_R,
  cx: LABEL_RIGHT - LABEL_R,
  cy: (LABEL_TOP + LABEL_BOTTOM) / 2,
};

export const TEXT_LEFT = 336;
/** ラベルの縁と文字の間に必ず空ける余白 */
export const TEXT_PAD = 56;

/**
 * y0〜y1 の帯の中で、ラベルの白地が続く右端の x。
 * 半円部分では上下の行ほど狭くなるので、帯の中でいちばん狭い所を返す。
 */
export function labelRightAt(y0: number, y1: number): number {
  const dy = Math.max(Math.abs(y0 - LABEL.cy), Math.abs(y1 - LABEL.cy));
  if (dy >= LABEL.r) return LABEL.cx;
  return LABEL.cx + Math.sqrt(LABEL.r * LABEL.r - dy * dy);
}
