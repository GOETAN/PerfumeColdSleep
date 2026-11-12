import '@fontsource/m-plus-1-code/500.css';
import '@fontsource/m-plus-1-code/700.css';
import './style.css';
import Sortable from 'sortablejs';
import { renderJacket } from './jacket/render';
import type { JacketModel, TextBox } from './jacket/label';
import { formatDuration, matches, normalize, songById, songs } from './songs';
import { REQUIRED, defaultTitle, loadState, saveState, totalOf } from './state';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  count: $('count'),
  barCount: $('bar-count'),
  search: $<HTMLInputElement>('search'),
  songList: $<HTMLUListElement>('song-list'),
  searchEmpty: $('search-empty'),
  selectedList: $<HTMLOListElement>('selected-list'),
  orderEmpty: $('order-empty'),
  clear: $<HTMLButtonElement>('clear'),
  name: $<HTMLInputElement>('name'),
  title: $<HTMLInputElement>('title'),
  titleReset: $<HTMLButtonElement>('title-reset'),
  total: $('total'),
  canvas: $<HTMLCanvasElement>('jacket'),
  canvasStatus: $('canvas-status'),
  exportHint: $('export-hint'),
  download: $<HTMLButtonElement>('download'),
  share: $<HTMLButtonElement>('share'),
};

const state = loadState();
let rendered = false; // 現在の state どおりの絵が canvas に出ているか
let renderSeq = 0;
let lastBoxes: TextBox[] = [];

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildModel(): JacketModel {
  const total = totalOf(state.selected);
  return {
    title: state.title.trim() || defaultTitle(state.name),
    tracks: state.selected.map((id) => {
      const s = songById.get(id)!;
      return { id: s.id, title: s.title, durationSec: s.durationSec };
    }),
    total: total.text + (total.unknown > 0 ? '+' : ''),
    date: todayLocal(),
  };
}

// ---- 曲一覧 ---------------------------------------------------------------
const songButtons = new Map<string, HTMLButtonElement>();

function buildSongList() {
  const frag = document.createDocumentFragment();
  for (const s of songs) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'song';
    b.dataset.id = s.id;
    const t = document.createElement('span');
    t.className = 'song-title';
    t.textContent = s.title;
    const m = document.createElement('span');
    m.className = 'song-meta';
    m.textContent = `${formatDuration(s.durationSec)} ・ ${s.release}`;
    b.append(t, m);
    li.append(b);
    frag.append(li);
    songButtons.set(s.id, b);
  }
  el.songList.append(frag);
  el.songList.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.song');
    if (b?.dataset.id) toggle(b.dataset.id);
  });
}

function applySearch() {
  const q = normalize(el.search.value);
  let shown = 0;
  for (const s of songs) {
    const hit = q === '' || matches(s, q);
    songButtons.get(s.id)!.parentElement!.hidden = !hit;
    if (hit) shown++;
  }
  el.searchEmpty.hidden = shown > 0;
}

function toggle(id: string) {
  const i = state.selected.indexOf(id);
  if (i >= 0) state.selected.splice(i, 1);
  else if (state.selected.length < REQUIRED) state.selected.push(id);
  else return;
  update();
}

// ---- 選んだ曲 -------------------------------------------------------------
function buildSelectedList() {
  el.selectedList.replaceChildren(
    ...state.selected.map((id, i) => {
      const s = songById.get(id)!;
      const li = document.createElement('li');
      li.dataset.id = id;
      const handle = document.createElement('span');
      handle.className = 'handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.textContent = '⠿';
      const body = document.createElement('span');
      body.className = 'sel-body';
      const t = document.createElement('span');
      t.className = 'song-title';
      t.textContent = `${String(i + 1).padStart(2, '0')}  ${s.title}`;
      const m = document.createElement('span');
      m.className = 'song-meta';
      m.textContent = `${formatDuration(s.durationSec)} ・ ${s.release}`;
      body.append(t, m);
      const mk = (label: string, text: string, act: string, disabled = false) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon';
        b.dataset.act = act;
        b.setAttribute('aria-label', `${s.title} を${label}`);
        b.textContent = text;
        b.disabled = disabled;
        return b;
      };
      li.append(
        handle,
        body,
        mk('上へ', '▲', 'up', i === 0),
        mk('下へ', '▼', 'down', i === state.selected.length - 1),
        mk('外す', '×', 'remove'),
      );
      return li;
    }),
  );
  el.orderEmpty.hidden = state.selected.length > 0;
  el.clear.hidden = state.selected.length === 0;
}

el.selectedList.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  const id = b?.closest('li')?.dataset.id;
  if (!b || !id) return;
  const i = state.selected.indexOf(id);
  if (b.dataset.act === 'remove') state.selected.splice(i, 1);
  else {
    const j = b.dataset.act === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= state.selected.length) return;
    [state.selected[i], state.selected[j]] = [state.selected[j], state.selected[i]];
  }
  update();
});

Sortable.create(el.selectedList, {
  handle: '.handle',
  animation: 150,
  ghostClass: 'drag-ghost',
  onEnd: () => {
    state.selected = Array.from(el.selectedList.children, (li) => (li as HTMLElement).dataset.id!);
    update();
  },
});

el.clear.addEventListener('click', () => {
  if (state.selected.length > 0 && confirm('選んだ曲をすべて外しますか？')) {
    state.selected = [];
    update();
  }
});

// ---- 名前・タイトル -------------------------------------------------------
el.name.addEventListener('input', () => {
  state.name = el.name.value;
  if (!state.titleEdited) {
    state.title = defaultTitle(state.name);
    el.title.value = state.title;
  }
  update();
});
el.title.addEventListener('input', () => {
  state.title = el.title.value;
  state.titleEdited = state.title !== defaultTitle(state.name);
  update();
});
el.titleReset.addEventListener('click', () => {
  state.titleEdited = false;
  state.title = defaultTitle(state.name);
  el.title.value = state.title;
  update();
});

// ---- 描画と出力 -----------------------------------------------------------
async function draw() {
  const seq = ++renderSeq;
  rendered = false;
  refreshExport();
  try {
    const boxes = await renderJacket(el.canvas, buildModel());
    if (seq !== renderSeq) return; // 待っている間に内容が変わった
    lastBoxes = boxes;
    rendered = true;
    el.canvasStatus.hidden = true;
  } catch (err) {
    if (seq !== renderSeq) return;
    el.canvasStatus.hidden = false;
    el.canvasStatus.textContent = `描画できませんでした: ${err instanceof Error ? err.message : String(err)}。通信環境を確認して再読み込みしてください。`;
  }
  refreshExport();
}

function refreshExport() {
  const n = state.selected.length;
  const ready = rendered && n === REQUIRED;
  el.download.disabled = !ready;
  el.share.disabled = !ready;
  const total = totalOf(state.selected);
  const truncated = lastBoxes.filter((b) => b.truncated).length;
  let hint = '';
  if (n < REQUIRED) hint = `あと ${REQUIRED - n} 曲選ぶと出力できます。`;
  else if (!rendered) hint = '描画中…';
  else if (truncated > 0) hint = `長すぎて末尾を「…」で省略した行が ${truncated} 行あります。`;
  if (total.unknown > 0) hint += ` 収録時間が不明の曲が ${total.unknown} 曲あり、合計には含めていません（画像では末尾に + を付けます）。`;
  el.exportHint.textContent = hint.trim();
}

function update() {
  const ok = saveState(state);
  const n = state.selected.length;
  const full = n >= REQUIRED;
  for (const [id, b] of songButtons) {
    const on = state.selected.includes(id);
    b.classList.toggle('is-selected', on);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = full && !on;
  }
  buildSelectedList();
  const total = totalOf(state.selected);
  el.count.textContent = `${n} / ${REQUIRED}`;
  el.count.classList.toggle('is-full', n === REQUIRED);
  el.barCount.textContent = `${n} / ${REQUIRED} 曲 ・ ${total.text}`;
  el.total.textContent = `合計 ${total.text}` + (ok ? '' : '（保存できません）');
  el.titleReset.hidden = !state.titleEdited;
  void draw();
}

function canvasBlob(): Promise<Blob> {
  return new Promise((resolve, reject) =>
    el.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG を作れませんでした'))), 'image/png'),
  );
}

el.download.addEventListener('click', async () => {
  if (state.selected.length !== REQUIRED || !rendered) return;
  const url = URL.createObjectURL(await canvasBlob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `favorites-${todayLocal()}.png`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

// ダウンロード属性が効かないアプリ内ブラウザ向けに、共有シートからも保存できるようにする
const probe = new File([''], 'a.png', { type: 'image/png' });
if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })) {
  el.share.hidden = false;
  el.share.addEventListener('click', async () => {
    if (state.selected.length !== REQUIRED || !rendered) return;
    const file = new File([await canvasBlob()], `favorites-${todayLocal()}.png`, { type: 'image/png' });
    try {
      await navigator.share({ files: [file] });
    } catch {
      // 利用者が閉じただけ
    }
  });
}

// ---- 起動 -----------------------------------------------------------------
el.name.value = state.name;
el.title.value = state.title;
buildSongList();
el.search.addEventListener('input', applySearch);
update();

// 自動テスト用: 最後に描いた文字の配置
Object.assign(window, { __jacket: { boxes: () => lastBoxes, rendered: () => rendered } });
