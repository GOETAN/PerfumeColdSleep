import { DISC, H, W } from './geometry';
import { mulberry32 } from './prng';

/**
 * 霜の付いたケース + CD 盤面。選曲に依存しないので固定シードで1回だけ描いて使い回す。
 * 画像素材は使わず、ノイズと枝分かれパターンだけで作る。
 */
const SEED = 20261112;

type Rnd = () => number;

/** 格子状の乱数を滑らかに補間した 2D ノイズ (0〜1)。 */
function makeNoise(rnd: Rnd, cols: number, rows: number) {
  const g = new Float32Array((cols + 1) * (rows + 1));
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const s = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number) => {
    const x = Math.min(Math.max(u, 0), 0.9999) * cols;
    const y = Math.min(Math.max(v, 0), 0.9999) * rows;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = s(x - xi);
    const fy = s(y - yi);
    const i = yi * (cols + 1) + xi;
    const a = g[i] + (g[i + 1] - g[i]) * fx;
    const b = g[i + cols + 1] + (g[i + cols + 2] - g[i + cols + 1]) * fx;
    return a + (b - a) * fy;
  };
}

/** 枝分かれする霜の枝。線ではなく小さな点の列で描き、粒状の質感にする。 */
function fern(ctx: CanvasRenderingContext2D, rnd: Rnd, x: number, y: number, ang: number, len: number, depth: number, size: number) {
  const step = size * 1.05;
  const steps = Math.max(3, Math.floor(len / step));
  for (let i = 0; i < steps; i++) {
    ang += (rnd() - 0.5) * 0.3;
    x += Math.cos(ang) * step;
    y += Math.sin(ang) * step;
    const s = size * (1 - (i / steps) * 0.45);
    ctx.rect(x - s / 2, y - s / 2, s, s);
    if (rnd() < 0.5) ctx.rect(x + (rnd() - 0.5) * s * 2.2, y + (rnd() - 0.5) * s * 2.2, s * 0.6, s * 0.6);
    if (depth > 0 && i > 1 && i % 3 === 0) {
      const sub = len * (1 - i / steps) * 0.55;
      if (sub > step * 2) {
        const spread = 0.85 + rnd() * 0.35;
        fern(ctx, rnd, x, y, ang + spread, sub, depth - 1, size * 0.82);
        fern(ctx, rnd, x, y, ang - spread, sub, depth - 1, size * 0.82);
      }
    }
  }
}

/** 中心から数本の枝が伸びる結晶のかたまり。 */
function crystal(ctx: CanvasRenderingContext2D, rnd: Rnd, x: number, y: number, radius: number) {
  const arms = 5 + Math.floor(rnd() * 4);
  const base = rnd() * Math.PI * 2;
  ctx.beginPath();
  for (let a = 0; a < arms; a++) {
    const ang = base + (a / arms) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    fern(ctx, rnd, x, y, ang, radius * (0.6 + rnd() * 0.5), 2, 4.2 + rnd() * 2.2);
  }
  ctx.fill();
}

function drawCase(ctx: CanvasRenderingContext2D, rnd: Rnd) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#d9dcdf');
  g.addColorStop(0.5, '#c3c7cb');
  g.addColorStop(1, '#d4d7da');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 低解像度の乱数画像を引き伸ばして、むらのある曇りを作る
  for (const [cols, alpha] of [[14, 0.5], [48, 0.28]] as const) {
    const rows = Math.round((cols * H) / W);
    const small = document.createElement('canvas');
    small.width = cols;
    small.height = rows;
    const sctx = small.getContext('2d')!;
    const img = sctx.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const v = 150 + Math.floor(rnd() * 105);
      img.data.set([v, v, v + 4, 255], i * 4);
    }
    sctx.putImageData(img, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
  }
  ctx.globalAlpha = 1;

  // ケースの縁の段差
  const bevel = (inset: number, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, 26);
    ctx.stroke();
  };
  bevel(30, 'rgba(255,255,255,0.75)', 10);
  bevel(44, 'rgba(110,120,130,0.22)', 4);
  bevel(84, 'rgba(255,255,255,0.45)', 6);
  bevel(94, 'rgba(110,120,130,0.16)', 3);
}

function drawDisc(ctx: CanvasRenderingContext2D) {
  const { cx, cy, r } = DISC;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // 青・紫・水色が回り込む虹色。conic gradient が無い環境では線形で代用する
  const stops: [number, string][] = [
    [0.0, '#63c9cf'], [0.1, '#c6ecef'], [0.2, '#7fb4e6'], [0.32, '#b3a3e6'],
    [0.42, '#d8d2f4'], [0.52, '#69b9dd'], [0.63, '#74d6cd'], [0.74, '#c2e6f2'],
    [0.84, '#9a9be0'], [0.93, '#8fd3e6'], [1.0, '#63c9cf'],
  ];
  const grad = typeof ctx.createConicGradient === 'function'
    ? ctx.createConicGradient(-0.7, cx, cy)
    : ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  for (const [o, c] of stops) grad.addColorStop(o, c);
  ctx.fillStyle = grad;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

  // 光の帯
  for (const [a0, a1, alpha] of [[-0.55, -0.32, 0.3], [0.5, 0.62, 0.22], [2.4, 2.75, 0.26], [3.9, 4.05, 0.18]] as const) {
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  glow.addColorStop(0, 'rgba(255,255,255,0.6)');
  glow.addColorStop(0.3, 'rgba(255,255,255,0.18)');
  glow.addColorStop(0.85, 'rgba(255,255,255,0)');
  glow.addColorStop(1, 'rgba(30,70,120,0.18)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  ctx.strokeStyle = 'rgba(60,110,150,0.45)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 16, 0, Math.PI * 2);
  ctx.stroke();
}

function drawFrost(ctx: CanvasRenderingContext2D, rnd: Rnd) {
  const density = makeNoise(rnd, 9, 8);
  const fine = makeNoise(rnd, 40, 35);
  const onDisc = (x: number, y: number) => Math.hypot(x - DISC.cx, y - DISC.cy) < DISC.r;

  // 細かい点描
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  for (let i = 0; i < 150000; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const d = density(x / W, y / H) * 0.6 + fine(x / W, y / H) * 0.4;
    if (rnd() > d * d * d * (onDisc(x, y) ? 1.0 : 1.6)) continue;
    const s = 1.4 + rnd() * 1.6;
    ctx.rect(x, y, s, s);
  }
  ctx.fill();

  // 結晶のかたまり。盤面の上はやや控えめにして色を見せる
  let placed = 0;
  for (let i = 0; i < 6000 && placed < 420; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const d = density(x / W, y / H);
    const edge = Math.min(x, y, W - x, H - y) < 150 ? 0.25 : 0;
    if (rnd() > d * d * (onDisc(x, y) ? 0.9 : 1.25) + edge) continue;
    ctx.fillStyle = `rgba(255,255,255,${0.82 + rnd() * 0.18})`;
    crystal(ctx, rnd, x, y, 70 + rnd() * rnd() * 190);
    placed++;
  }
}

let cached: HTMLCanvasElement | null = null;

export function getBackground(): HTMLCanvasElement {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(SEED);
  drawCase(ctx, rnd);
  drawDisc(ctx);
  drawFrost(ctx, rnd);
  cached = c;
  return c;
}
