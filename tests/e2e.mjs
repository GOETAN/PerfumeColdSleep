// 使い方: npm run build && npm run test:e2e
// vite preview を立ち上げ、実ブラウザで完成条件を確認する。
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// playwright はこのプロジェクトの依存に入れていない（実行環境に入っているものを使う）
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const OUT = process.env.E2E_OUT ?? 'tests/out';
mkdirSync(OUT, { recursive: true });

const songs = JSON.parse(readFileSync('data/songs.json', 'utf8'));
const byLen = [...songs].sort((a, b) => [...b.title].length - [...a.title].length);
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(URL)).ok) break; } catch { /* まだ起動中 */ }
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();
try {
  // ---- デスクトップ: 最長タイトル13曲 + 長い名前（最悪ケース） ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith(URL) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__jacket?.rendered());

  check('0曲では出力できない', await page.locator('#download').isDisabled());
  for (const s of byLen.slice(0, 12)) await page.click(`button.song[data-id="${s.id}"]`);
  await page.waitForFunction(() => window.__jacket.rendered());
  check('12曲では出力できない', await page.locator('#download').isDisabled());
  await page.click(`button.song[data-id="${byLen[12].id}"]`);
  check('13曲で他の曲は選べなくなる', await page.locator(`button.song[data-id="${byLen[13].id}"]`).isDisabled());

  const verifyBoxes = async (label) => {
    await page.waitForFunction(() => window.__jacket.rendered());
    const boxes = await page.evaluate(() => window.__jacket.boxes());
    const over = boxes.filter((b) => b.x + b.width > b.limit + 0.5);
    check(`${label}: 全 ${boxes.length} 行がラベルの内側`, boxes.length >= 42 && over.length === 0, over.map((b) => b.role).join(','));
    return boxes;
  };
  await verifyBoxes('最長13曲');

  await page.fill('#name', 'あいうえおかきくけこさしすせそたちつてとなにぬね');
  const boxes = await verifyBoxes('最長の名前');
  check('タイトルが名前に連動', boxes.find((b) => b.role === 'title2')?.text.includes('Selected by あいうえお'));
  await page.fill('#title', 'W'.repeat(60));
  await verifyBoxes('最長のタイトル(60字)');
  await page.click('#title-reset');
  await page.fill('#name', 'TESTER');
  await verifyBoxes('通常の名前');

  // フォント: 描いた全文字が Web フォントで読み込み済み
  const fontOk = await page.evaluate(() => {
    const text = window.__jacket.boxes().map((b) => b.text).join('');
    return [500, 700].every((w) => document.fonts.check(`${w} 40px "M PLUS 1 Code"`, text))
      && [...document.fonts].some((f) => f.family.includes('M PLUS 1 Code') && f.status === 'loaded');
  });
  check('描画時点でフォント読み込み済み', fontOk);

  // 合計時間
  const sec = byLen.slice(0, 13).reduce((a, s) => a + (s.durationSec ?? 0), 0);
  const expected = `${Math.floor(sec / 60)}min ${String(sec % 60).padStart(2, '0')}sec`;
  check('合計時間の表示', (await page.textContent('#total')).includes(expected), expected);

  // バーコードは選曲で決まる: 同じ並びなら同じ絵、並べ替えると変わる
  const snap = () => page.evaluate(() => {
    const c = document.getElementById('jacket');
    const d = c.getContext('2d').getImageData(84, 238, 184, 1300).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (Math.imul(h, 31) + d[i]) | 0;
    return h;
  });
  const before = await snap();
  await page.click('#selected-list li:nth-child(2) button[data-act="up"]');
  await page.waitForFunction(() => window.__jacket.rendered());
  const moved = await snap();
  await page.click('#selected-list li:nth-child(2) button[data-act="up"]');
  await page.waitForFunction(() => window.__jacket.rendered());
  check('並べ替えで模様が変わり、戻すと同じ模様に戻る', before !== moved && before === (await snap()));

  // ドラッグで並べ替え
  const firstId = await page.getAttribute('#selected-list li:nth-child(1)', 'data-id');
  const h1 = await page.locator('#selected-list li:nth-child(1) .handle').boundingBox();
  const h4 = await page.locator('#selected-list li:nth-child(4) .handle').boundingBox();
  await page.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2);
  await page.mouse.down();
  await page.mouse.move(h1.x + h1.width / 2, h1.y + 30, { steps: 5 });
  await page.mouse.move(h4.x + h4.width / 2, h4.y + h4.height / 2 + 8, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const order = await page.$$eval('#selected-list li', (els) => els.map((e) => e.dataset.id));
  check('ドラッグで並べ替えできる', order[0] !== firstId && order.includes(firstId) && order.length === 13, `元の1曲目 → ${order.indexOf(firstId) + 1} 番目`);

  // PNG 出力
  await page.waitForFunction(() => window.__jacket.rendered());
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const file = `${OUT}/jacket.png`;
  await download.saveAs(file);
  const png = readFileSync(file);
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  check('PNG を 2048x1776 で出力', png.subarray(1, 4).toString() === 'PNG' && w === 2048 && h === 1776, `${w}x${h}, ${(png.length / 1e6).toFixed(1)} MB`);

  // リロードしても消えない
  await page.reload();
  await page.waitForFunction(() => window.__jacket?.rendered());
  const after = await page.$$eval('#selected-list li', (els) => els.map((e) => e.dataset.id));
  check('リロード後も選曲・並び・名前が残る', JSON.stringify(after) === JSON.stringify(order) && (await page.inputValue('#name')) === 'TESTER');
  check('実行時に外部へアクセスしない', external.length === 0, external.slice(0, 3).join(' '));

  // 検索
  await page.fill('#search', 'ぽりりずむ');
  const hits = await page.$$eval('#song-list li:not([hidden]) .song-title', (els) => els.map((e) => e.textContent));
  check('ひらがなでカタカナの曲名を検索できる', hits.length > 0 && hits.length < 10 && hits.some((t) => t === 'ポリリズム'), hits.join(' / '));

  // 最初からやり直す: キャンセルなら何も変わらず、OK なら全部消えてリロード後も戻らない
  page.once('dialog', (d) => d.dismiss());
  await page.click('#reset');
  check('やり直し: キャンセルでは消えない', (await page.locator('#selected-list li').count()) === 13);
  page.once('dialog', (d) => d.accept());
  await page.click('#reset');
  await page.waitForFunction(() => window.__jacket.rendered());
  const cleared = async () => (await page.locator('#selected-list li').count()) === 0 && (await page.inputValue('#name')) === ''
    && (await page.inputValue('#title')) === 'FAVORITES (Selected by 〇〇)' && (await page.inputValue('#search')) === '';
  const c1 = await cleared();
  await page.reload();
  await page.waitForFunction(() => window.__jacket?.rendered());
  check('やり直し: 全部消え、リロード後も消えたまま', c1 && (await cleared()) && (await page.locator('#download').isDisabled()));
  await page.screenshot({ path: `${OUT}/desktop.png`, fullPage: true });
  await ctx.close();

  // ---- スマホ: タップで選んで出力できる・横にはみ出さない ----
  const mctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const m = await mctx.newPage();
  await m.goto(URL);
  await m.waitForFunction(() => window.__jacket?.rendered());
  for (const s of songs.slice(20, 33)) await m.tap(`button.song[data-id="${s.id}"]`);
  await m.tap('#selected-list li:nth-child(3) button[data-act="down"]');
  await m.waitForFunction(() => window.__jacket.rendered());
  check('スマホ: 13曲選ぶと出力ボタンが有効', await m.locator('#download').isEnabled());
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('スマホ: 横スクロールが出ない', overflow <= 0, `${overflow}px`);
  const small = await m.$$eval('button, input, .handle', (els) => els.filter((e) => e.offsetParent && (e.offsetHeight < 40 || e.offsetWidth < 40) && !e.classList.contains('link')).length);
  check('スマホ: 操作部品が 40px 以上', small === 0, `${small} 個が小さい`);
  const [md] = await Promise.all([m.waitForEvent('download'), m.tap('#download')]);
  check('スマホ: PNG をダウンロード', (await md.path()) !== null);
  const rb = await m.locator('#reset').boundingBox();
  await m.evaluate(() => window.scrollTo(0, 0));
  const rb2 = await m.locator('#reset').boundingBox();
  check('スマホ: やり直しボタンが右上に収まる', rb2.x + rb2.width <= 390 && rb2.x > 195 && rb2.y < 80 && rb.height >= 40, `x=${Math.round(rb2.x)} y=${Math.round(rb2.y)}`);
  await m.screenshot({ path: `${OUT}/mobile.png`, fullPage: true });
  await mctx.close();
} finally {
  await browser.close();
  server.kill();
}
console.log(failures === 0 ? '\nすべて通過' : `\n${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
