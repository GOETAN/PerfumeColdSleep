import { LABEL, TEXT_LEFT, TEXT_PAD, labelRightAt } from './geometry';
import { fnv1a, mulberry32 } from './prng';

export const FONT_FAMILY = '"M PLUS 1 Code"';
export const WEIGHTS = [500, 700] as const;

export interface JacketModel {
  /** 改行を含まないタイトル。" (" の前で2行に分ける */
  title: string;
  tracks: { id: string; title: string; durationSec: number | null }[];
  /** "55min 12sec" 形式 */
  total: string;
  /** YYYY-MM-DD */
  date: string;
}

/** 描いた文字1件ぶんの記録。はみ出しの自動検査に使う。 */
export interface TextBox {
  role: string;
  text: string;
  x: number;
  top: number;
  bottom: number;
  width: number;
  /** この行で文字が使ってよい右端 */
  limit: number;
  truncated: boolean;
}

function font(weight: number, size: number) {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

/**
 * maxWidth に収まるまで縮め、最小サイズでも入らなければ末尾を … で切る。
 * 戻り値の width は必ず maxWidth 以下。
 */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number, minScale = 0.62) {
  ctx.font = font(weight, size);
  let width = ctx.measureText(text).width;
  if (width <= maxWidth) return { text, size, width, truncated: false };
  size = Math.max(Math.floor(size * minScale), Math.floor((size * maxWidth) / width));
  ctx.font = font(weight, size);
  width = ctx.measureText(text).width;
  let chars = Array.from(text);
  let truncated = false;
  while (width > maxWidth && chars.length > 1) {
    chars = chars.slice(0, -1);
    truncated = true;
    width = ctx.measureText(chars.join('').trimEnd() + '…').width;
  }
  return { text: truncated ? chars.join('').trimEnd() + '…' : text, size, width, truncated };
}

function formatDuration(sec: number | null) {
  return sec === null ? '-:--' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** 選んだ曲（順番込み）から決まる模様。同じ選曲・同じ並びなら必ず同じになる。 */
function drawBarcode(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, w: number, h: number) {
  const rnd = mulberry32(fnv1a(key));
  ctx.fillStyle = '#000';
  const solid = 64;
  const lines = (yy: number, count: number, dir: 1 | -1) => {
    for (let i = 0; i < count; i++) {
      const lh = 4 + Math.floor(rnd() * 5);
      ctx.fillRect(x, dir === 1 ? yy : yy - lh, w, lh);
      yy += dir * (lh + 8);
    }
    return yy;
  };
  ctx.fillRect(x, y, w, solid);
  const top = lines(y + solid + 12, 4, 1) + 8;
  ctx.fillRect(x, y + h - solid, w, solid);
  const bottom = lines(y + h - solid - 12, 5, -1) - 8;

  const cols = 12;
  const cell = w / cols;
  const rows = Math.floor((bottom - top) / cell);
  const ch = (bottom - top) / rows;
  for (let r = 0; r < rows; r++) {
    const band = rnd();
    if (band < 0.07) {
      ctx.fillRect(x, top + r * ch, w, Math.ceil(ch));
      continue;
    }
    let on = rnd() < 0.5;
    for (let c = 0; c < cols; c++) {
      if (rnd() < 0.45) on = !on;
      if (on) ctx.fillRect(Math.floor(x + c * cell), Math.floor(top + r * ch), Math.ceil(cell), Math.ceil(ch));
    }
  }
}

export function drawLabel(ctx: CanvasRenderingContext2D, model: JacketModel): TextBox[] {
  const boxes: TextBox[] = [];

  // 白ラベル
  ctx.save();
  ctx.shadowColor = 'rgba(20,40,60,0.22)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(-40, LABEL.top);
  ctx.lineTo(LABEL.cx, LABEL.top);
  ctx.arc(LABEL.cx, LABEL.cy, LABEL.r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(-40, LABEL.bottom);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  /** 1行描く。行の箱 (top〜top+lineHeight) が半円に掛かる分だけ幅を狭める。 */
  const line = (role: string, text: string, x: number, top: number, size: number, weight: number, minScale?: number) => {
    const bottom = top + size * 1.12;
    const limit = labelRightAt(top - size * 0.08, bottom) - TEXT_PAD;
    const f = fit(ctx, text, weight, size, Math.max(limit - x, 0), minScale);
    ctx.font = font(weight, f.size);
    // 縮めた行は元の行の箱の中で縦位置を保つ
    ctx.fillText(f.text, x, top + size * 0.9 - (size - f.size) * 0.35);
    boxes.push({ role, text: f.text, x, top, bottom, width: f.width, limit, truncated: f.truncated });
    return f;
  };

  // タイトル（最大2行）
  const TITLE_TOP = 232;
  const TITLE_SIZE = 78;
  const TITLE_PITCH = 94;
  const cut = model.title.indexOf(' (');
  const titleLines = cut > 0 ? [model.title.slice(0, cut), model.title.slice(cut + 1)] : [model.title];
  titleLines.forEach((t, i) => line(`title${i + 1}`, t.toUpperCase() === t ? t : t, TEXT_LEFT, TITLE_TOP + i * TITLE_PITCH, TITLE_SIZE, 700, 0.5));

  // 曲目 13行: 「01  4:09  曲名」
  const LIST_TOP = 476;
  const ROW_SIZE = 46;
  const ROW_PITCH = 66;
  ctx.font = font(500, ROW_SIZE);
  const chW = ctx.measureText('0').width;
  const titleX = TEXT_LEFT + chW * 11;
  model.tracks.forEach((t, i) => {
    const top = LIST_TOP + i * ROW_PITCH;
    line(`no${i + 1}`, String(i + 1).padStart(2, '0'), TEXT_LEFT, top, ROW_SIZE, 700);
    line(`time${i + 1}`, formatDuration(t.durationSec).padStart(5, ' '), TEXT_LEFT + chW * 4, top, ROW_SIZE, 500);
    line(`track${i + 1}`, t.title, titleX, top, ROW_SIZE, 700);
  });

  // フッター
  const FOOT_TOP = 1380;
  const FOOT_SIZE = 38;
  const FOOT_PITCH = 50;
  line('foot1', `${model.tracks.length} TRACKS  TOTAL ${model.total}`, TEXT_LEFT, FOOT_TOP, FOOT_SIZE, 500);
  line('foot2', `DATE:${model.date}  NOT FOR SALE`, TEXT_LEFT, FOOT_TOP + FOOT_PITCH, FOOT_SIZE, 500);
  line('foot3', 'UNOFFICIAL FAN MADE', TEXT_LEFT, FOOT_TOP + FOOT_PITCH * 2 + 4, 46, 700);

  drawBarcode(ctx, model.tracks.map((t) => t.id).join('|'), 84, TITLE_TOP + 6, 184, FOOT_TOP + FOOT_PITCH * 2 + 4 + 46 - TITLE_TOP);
  return boxes;
}
