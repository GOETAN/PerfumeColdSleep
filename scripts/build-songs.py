#!/usr/bin/env python3
"""Perfume の曲一覧 (data/songs.json) を Wikipedia 日本語版から生成する。

MediaWiki API (action=parse, prop=wikitext) だけを使い、HTML は取得しない。
標準ライブラリのみで動く。取得した wikitext は .cache/wiki/ に保存し、
2回目以降はネットワークに出ない（--refresh で再取得）。

使い方:
    WIKI_CONTACT="you@example.com" python3 scripts/build-songs.py
    python3 scripts/build-songs.py --contact "https://example.com/about"

出力 (data/):
    manual-durations.json（入力）時間が取れなかった曲に手で与える時間
    songs.json      [{ id, title, durationSec, release, releaseType, sourceArticle }]
                    releaseType: single / digital-single / ep / album / best / compilation
    duplicates.txt  同じ曲名で収録時間が違うもの（まとめていない。人が判断する）
    missing.txt     収録時間が取れなかった曲 (durationSec: null)
    merged.txt      同じ曲名・同じ収録時間なので1件にまとめたもの
    excluded.txt    除外したもの（映像特典・インストゥルメンタル・exclude-ids.txt 指定）
    unlinked.txt    一覧にあるが記事が無い作品と、その扱い
    unparsed.txt    記事はあるが収録曲を1曲も取り出せなかった作品

data/exclude-ids.txt に id を1行ずつ書いて再実行すると、その曲を songs.json から外す
（duplicates.txt を見て不要な方を消すためのもの）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

API = "https://ja.wikipedia.org/w/api.php"
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "wiki"
MIN_INTERVAL = 2.0  # 秒。1秒に1回以下に抑える（429 が出たので余裕を持たせる）

# 一覧ページの中で対象にする節 → 種別
SECTIONS = {
    "CDシングル": "single",
    "配信限定シングル": "digital-single",
    "EP": "ep",
    "オリジナルアルバム": "album",
    "ベストアルバム": "best",
    "コンピレーションアルバム": "compilation",
}
# 既発シングル3枚をまとめただけのボックスセット。曲は各シングルから取れる。
SKIP_ARTICLES = {"Fan Service〜Prima Box〜"}

VIDEO_RE = re.compile(r"DVD|Blu-?ray|ブルーレイ|\bBD\b|映像|ビデオ|VIDEO", re.I)
# 特典ディスクのトーク音源など、曲ではないもの
TALK_RE = re.compile(r"レイディオ|ラジオが好き")
INST_RE = re.compile(
    r"instrumental|インストゥルメンタル|インスト\b|カラオケ|karaoke|オリジナル・?カラオケ", re.I
)


# --------------------------------------------------------------------------
# 取得
# --------------------------------------------------------------------------
class Fetcher:
    def __init__(self, user_agent: str, refresh: bool):
        self.ua = user_agent
        self.refresh = refresh
        self.last = 0.0
        self.requests = 0
        CACHE.mkdir(parents=True, exist_ok=True)

    def wikitext(self, page: str) -> tuple[str, str] | None:
        """(正規化後の記事名, wikitext) を返す。記事が無ければ None。"""
        path = CACHE / (hashlib.sha1(page.encode()).hexdigest()[:16] + ".json")
        if path.exists() and not self.refresh:
            data = json.loads(path.read_text(encoding="utf-8"))
        else:
            data = self._get(page)
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        if "parse" not in data:
            return None
        return data["parse"]["title"], data["parse"]["wikitext"]

    def _get(self, page: str) -> dict:
        qs = urllib.parse.urlencode(
            {
                "action": "parse",
                "page": page,
                "prop": "wikitext",
                "redirects": 1,
                "format": "json",
                "formatversion": 2,
                "maxlag": 5,
            }
        )
        req = urllib.request.Request(f"{API}?{qs}", headers={"User-Agent": self.ua})
        for attempt in range(5):
            wait = self.last + MIN_INTERVAL - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            self.requests += 1
            try:
                with urllib.request.urlopen(req, timeout=30) as res:
                    data = json.loads(res.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                # 429/503 は Retry-After に従う。無ければ 15, 30, 60... 秒待つ
                retry_after = e.headers.get("Retry-After", "") if e.headers else ""
                delay = int(retry_after) if retry_after.isdigit() else 15 * 2**attempt
                print(f"  retry {attempt + 1}: {page}: HTTP {e.code}、{delay} 秒待機", file=sys.stderr)
                time.sleep(delay)
                continue
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                print(f"  retry {attempt + 1}: {page}: {e}", file=sys.stderr)
                time.sleep(2**attempt)
                continue
            err = data.get("error", {})
            if err.get("code") == "maxlag":
                time.sleep(5)
                continue
            return data  # 'parse' か、missingtitle 等の 'error'
        raise SystemExit(f"取得に失敗しました: {page}")


# --------------------------------------------------------------------------
# wikitext の小道具
# --------------------------------------------------------------------------
def strip_markup(s: str) -> str:
    """セルや引数の値から、表示される文字列だけを取り出す。"""
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<br\s*/?>", " ", s)
    # {{efn|...}} など注釈系は捨て、{{lang|en|X}} は X を残す
    for _ in range(5):
        s2 = re.sub(r"\{\{\s*(?:lang|Lang)\s*\|[^|{}]*\|([^{}]*)\}\}", r"\1", s)
        s2 = re.sub(r"\{\{[^{}]*\}\}", "", s2)
        if s2 == s:
            break
        s = s2
    s = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"'{2,}", "", s)
    s = re.sub(r"</?(?:small|span|nowiki|sup|sub|u|s|b|i)[^>]*>", "", s)
    s = s.replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"\s+", " ", s).strip()


def link_target(s: str) -> str | None:
    m = re.search(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]", s)
    return m.group(1).strip() if m else None


def split_top(s: str, sep: str = "|") -> list[str]:
    """[[ ]] と {{ }} の外側にある sep だけで分割する。"""
    out, depth, cur, i = [], 0, [], 0
    while i < len(s):
        two = s[i : i + 2]
        if two in ("[[", "{{"):
            depth += 1
            cur.append(two)
            i += 2
        elif two in ("]]", "}}"):
            depth -= 1
            cur.append(two)
            i += 2
        elif s[i] == sep and depth == 0:
            out.append("".join(cur))
            cur = []
            i += 1
        else:
            cur.append(s[i])
            i += 1
    out.append("".join(cur))
    return out


def find_templates(text: str, names: tuple[str, ...]) -> list[tuple[int, str]]:
    """名前が names のいずれかのテンプレートを (開始位置, 中身) で返す。"""
    found = []
    pat = re.compile(r"\{\{\s*(" + "|".join(names) + r")\s*(?=[|}\n])", re.I)
    for m in pat.finditer(text):
        depth, i = 0, m.start()
        while i < len(text):
            two = text[i : i + 2]
            if two == "{{":
                depth += 1
                i += 2
            elif two == "}}":
                depth -= 1
                i += 2
                if depth == 0:
                    break
            else:
                i += 1
        found.append((m.start(), text[m.end() : i - 2]))
    return found


def parse_length(s: str) -> int | None:
    m = re.search(r"(\d{1,2})\s*[:：]\s*(\d{2})", s)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    m = re.search(r"(\d{1,2})\s*分\s*(\d{1,2})\s*秒", s)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    return None


# --------------------------------------------------------------------------
# 一覧ページ → 作品
# --------------------------------------------------------------------------
@dataclass
class Release:
    title: str
    article: str | None
    kind: str
    date: str  # YYYY-MM-DD。不明なら ''
    order: int


def parse_releases(wikitext: str) -> list[Release]:
    parts = re.split(r"\n(={2,}[^=\n]+={2,})[ \t]*(?=\n)", "\n" + wikitext)
    releases: list[Release] = []
    for i in range(1, len(parts), 2):
        name = parts[i].strip("= \t")
        kind = SECTIONS.get(name)
        if not kind:
            continue
        body = parts[i + 1]
        for table in re.findall(r"\{\|.*?\n\|\}", body, flags=re.S):
            last_date = ""
            for row in re.split(r"\n\|-[^\n]*", table):
                cells = [ln for ln in row.split("\n") if ln.startswith("|") and not ln.startswith("|+")]
                dm = re.search(r"(\d{4})年(?:\{\{0\}\})?(\d{1,2})月(?:\{\{0\}\})?(\d{1,2})日", row)
                if dm:
                    last_date = "%04d-%02d-%02d" % tuple(int(x) for x in dm.groups())
                cell = None
                if kind == "digital-single":
                    # 「! 1st」の次のセルがタイトル
                    if re.search(r"^!\s*\d+(?:st|nd|rd|th)", row, flags=re.M) and cells:
                        cell = split_top(cells[0][1:])[-1]
                else:
                    for ln in cells:
                        val = split_top(ln[1:])[-1].strip()
                        if re.fullmatch(r"'''.+?'''", val):
                            cell = val
                            break
                if cell is None:
                    continue
                title = strip_markup(cell)
                if not title:
                    continue
                # 注釈テンプレート内のリンク（共演者など）を作品の記事と取り違えない
                bare = re.sub(r"\{\{[^{}]*\}\}", "", cell)
                releases.append(Release(title, link_target(bare), kind, last_date if dm else "", len(releases)))
    return releases


# --------------------------------------------------------------------------
# 作品の記事 → 曲
# --------------------------------------------------------------------------
@dataclass
class Track:
    title: str
    durationSec: int | None
    release: str
    sourceArticle: str
    date: str
    order: int
    context: str = ""
    id: str = field(default="")


def heading_context(text: str, pos: int) -> str:
    """pos より前にある見出しを、階層をたどって ' > ' でつなぐ。"""
    stack: list[tuple[int, str]] = []
    for m in re.finditer(r"^(={2,})\s*(.+?)\s*\1[ \t]*$", text[:pos], flags=re.M):
        level = len(m.group(1))
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, strip_markup(m.group(2))))
    return " > ".join(h for _, h in stack)


def parse_tracks(article: str, wikitext: str, rel: Release, excluded: list[str]) -> list[Track]:
    tracks: list[Track] = []
    for pos, body in find_templates(wikitext, ("tracklist", "track listing")):
        params: dict[str, str] = {}
        for p in split_top(body):
            if "=" in p:
                k, v = p.split("=", 1)
                params[k.strip().lower()] = v.strip()
        ctx = heading_context(wikitext, pos)
        headline = strip_markup(params.get("headline", ""))
        where = " / ".join(x for x in (ctx, headline) if x)
        is_video = bool(VIDEO_RE.search(headline)) or (
            not re.search(r"CD|Disc|DISC", headline) and bool(VIDEO_RE.search(ctx.split(" > ")[-1] if ctx else ""))
        )
        nums = sorted(int(k[5:]) for k in params if re.fullmatch(r"title\d+", k))
        for n in nums:
            # 末尾の ※ は記事内の注記への目印で、曲名の一部ではない
            title = re.sub(r"\s*※+$", "", strip_markup(params[f"title{n}"]))
            if not title:
                continue
            if TALK_RE.search(title):
                excluded.append(f"[トーク音源] {article} / {where} / {title}")
                continue
            note = strip_markup(params.get(f"note{n}", ""))
            if is_video:
                excluded.append(f"[映像] {article} / {where} / {title}")
                continue
            if INST_RE.search(title) or INST_RE.search(note):
                excluded.append(f"[インスト] {article} / {where} / {title}" + (f" ({note})" if note else ""))
                continue
            tracks.append(
                Track(title, parse_length(params.get(f"length{n}", "")), rel.title, article, rel.date, rel.order, where)
            )
    if tracks:
        return tracks

    # tracklist テンプレートが無い古い記事: 「# '''曲名''' [3:54]」「1.'''曲名''' [3:54]」形式の行
    for m in re.finditer(r"^(?:#|\d+\s*[.．])\s*'''(.+?)'''(.*)$", wikitext, flags=re.M):
        title = strip_markup(m.group(1))
        ctx = heading_context(wikitext, m.start())
        if not title or not re.search(r"収録|CD|曲目", ctx):
            continue
        last = ctx.split(" > ")[-1]
        if VIDEO_RE.search(last) or re.search(r"Video Clip|ビデオクリップ|PV\b", title, re.I):
            excluded.append(f"[映像] {article} / {ctx} / {title}")
            continue
        if INST_RE.search(title):
            excluded.append(f"[インスト] {article} / {ctx} / {title}")
            continue
        tracks.append(Track(title, parse_length(m.group(2)), rel.title, article, rel.date, rel.order, ctx))
    return tracks


# --------------------------------------------------------------------------
# まとめ
# --------------------------------------------------------------------------
def norm_title(t: str) -> str:
    t = unicodedata.normalize("NFKC", t).casefold()
    return re.sub(r"[\s　]+", "", t)


def fmt(sec: int | None) -> str:
    return "--:--" if sec is None else f"{sec // 60}:{sec % 60:02d}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list-page", default="Perfumeの作品")
    ap.add_argument("--contact", default=os.environ.get("WIKI_CONTACT", ""), help="User-Agent に入れる連絡先（メールか URL）")
    ap.add_argument("--no-contact", action="store_true", help="連絡先なしで実行する（非推奨）")
    ap.add_argument("--refresh", action="store_true", help="キャッシュを使わず取り直す")
    ap.add_argument("--out", default=str(ROOT / "data"))
    args = ap.parse_args()

    if not args.contact and not args.no_contact:
        raise SystemExit("連絡先がありません。WIKI_CONTACT か --contact を指定してください。")
    ua = "favorites-jacket-song-builder/1.0"
    ua += f" ({args.contact})" if args.contact else " (contact not provided)"
    fetch = Fetcher(ua, args.refresh)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    got = fetch.wikitext(args.list_page)
    if not got:
        raise SystemExit(f"一覧ページが見つかりません: {args.list_page}")
    got_list_title = got[0]
    releases = parse_releases(got[1])

    unlinked, unparsed, excluded = [], [], []
    tracks: list[Track] = []
    seen_articles: set[str] = set()
    no_article: list[Release] = []
    for rel in releases:
        if not rel.article:
            no_article.append(rel)
            continue
        if rel.article in SKIP_ARTICLES or rel.article in seen_articles:
            continue
        seen_articles.add(rel.article)
        got = fetch.wikitext(rel.article)
        if not got:
            unparsed.append(f"{rel.article}\t記事が取得できない")
            continue
        article, text = got
        found = parse_tracks(article, text, rel, excluded)
        if not found:
            why = "収録曲の節が無い（曲単体の記事）" if not re.search(r"==\s*[^=\n]*(収録|曲目|CD)", text) else "収録曲の書式を解析できない"
            unparsed.append(f"{rel.kind}\t{article}\t{why}")
        tracks.extend(found)
        print(f"{rel.kind:15s} {rel.date:10s} {article}: {len(found)} 曲", file=sys.stderr)

    # 記事が無いシングルは、表題曲だけを一覧ページから入れる。収録時間は分からないので null。
    # 同じ曲名が他の作品から取れていれば、そちら（時間あり）を使い、null の重複は作らない。
    # カップリング曲は一覧ページに載っていないので入らない。
    known = {norm_title(t.title) for t in tracks}
    for rel in no_article:
        if rel.kind not in ("single", "digital-single"):
            unlinked.append(f"{rel.kind}\t{rel.date}\t{rel.title}\t曲ではないので未収録")
        elif norm_title(rel.title) in known:
            unlinked.append(f"{rel.kind}\t{rel.date}\t{rel.title}\t他の作品の記事から取得済み")
        else:
            tracks.append(Track(rel.title, None, rel.title, got_list_title, rel.date, rel.order, "一覧ページ（記事なし）"))
            unlinked.append(f"{rel.kind}\t{rel.date}\t{rel.title}\t表題曲のみ時間なしで収録")

    # Wikipedia から時間が取れなかった曲に、人が調べた時間を当てる (data/manual-durations.json)。
    # 取得できた時間を上書きすることはしない。
    manual_path = out / "manual-durations.json"
    manual_used = []
    if manual_path.exists():
        manual = {norm_title(m["title"]): int(m["durationSec"]) for m in json.loads(manual_path.read_text(encoding="utf-8"))}
        for t in tracks:
            if t.durationSec is None and norm_title(t.title) in manual:
                t.durationSec = manual.pop(norm_title(t.title))
                manual_used.append(t.title)
        for left in manual:
            print(f"  manual-durations.json: 当てはまる曲が無い: {left}", file=sys.stderr)

    # 同じ曲名・同じ時間 → 1件にまとめる（発売日が早い方を残す）
    tracks.sort(key=lambda t: (t.date or "9999", t.order))
    merged_note: dict[tuple[str, int | None], list[Track]] = {}
    for t in tracks:
        merged_note.setdefault((norm_title(t.title), t.durationSec), []).append(t)
    songs: list[Track] = []
    merged_lines = []
    for (_, _), group in merged_note.items():
        keep = group[0]
        songs.append(keep)
        others = sorted({g.sourceArticle for g in group[1:]} - {keep.sourceArticle})
        if others:
            merged_lines.append(f"{keep.title} [{fmt(keep.durationSec)}] 採用: {keep.sourceArticle} / 同一: {', '.join(others)}")

    for s in songs:
        s.id = hashlib.sha1(f"{s.title}|{s.durationSec}|{s.sourceArticle}".encode()).hexdigest()[:10]

    # 人が外すと決めた id
    ex_path = out / "exclude-ids.txt"
    drop = set()
    if ex_path.exists():
        drop = {ln.split("#")[0].strip() for ln in ex_path.read_text(encoding="utf-8").splitlines()} - {""}
    for s in songs:
        if s.id in drop:
            excluded.append(f"[exclude-ids] {s.id} {s.title} [{fmt(s.durationSec)}] {s.sourceArticle}")
    songs = [s for s in songs if s.id not in drop]

    # 同じ曲名で時間が違う → まとめずに一覧へ
    by_title: dict[str, list[Track]] = {}
    for s in songs:
        by_title.setdefault(norm_title(s.title), []).append(s)
    dup_lines = []
    for group in by_title.values():
        if len(group) > 1:
            dup_lines.append(group[0].title)
            for s in group:
                dup_lines.append(f"  {s.id}  {fmt(s.durationSec):>5}  {s.release}  ({s.sourceArticle} / {s.context})")
            dup_lines.append("")

    missing = [f"{s.id}\t{s.title}\t{s.sourceArticle}\t{s.context}" for s in songs if s.durationSec is None]

    songs.sort(key=lambda s: (s.date or "9999", s.order))
    # releaseType は、その曲を採用した作品（同じ曲が複数作品にあれば発売が早い方）の種別
    kind_of = {r.order: r.kind for r in releases}
    payload = [
        {
            "id": s.id,
            "title": s.title,
            "durationSec": s.durationSec,
            "release": s.release,
            "releaseType": kind_of[s.order],
            "sourceArticle": s.sourceArticle,
        }
        for s in songs
    ]
    (out / "songs.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    def report(name: str, head: str, lines: list[str]) -> None:
        (out / name).write_text(f"# {head}\n# {len([l for l in lines if l and not l.startswith(' ')])} 件\n\n" + "\n".join(lines) + "\n", encoding="utf-8")

    report("duplicates.txt", "同じ曲名で収録時間が違うもの。不要な方の id を exclude-ids.txt に書いて再実行する", dup_lines)
    report("missing.txt", "収録時間が取れなかった曲 (durationSec: null)。id / 曲名 / 記事 / 場所", missing)
    report("merged.txt", "同じ曲名・同じ収録時間なので1件にまとめたもの", merged_lines)
    report("excluded.txt", "songs.json に入れなかったもの", excluded)
    report("unlinked.txt", "一覧にあるが記事が無い作品。種別 / 日付 / 題 / 扱い", unlinked)
    report("unparsed.txt", "記事はあるが収録曲を取り出せなかった作品", unparsed)

    print(
        f"\n作品 {len(releases)} / 記事 {len(seen_articles)} / 曲 {len(songs)} / 時間なし {len(missing)} / "
        f"重複グループ {sum(1 for g in by_title.values() if len(g) > 1)} / 記事なし {len(unlinked)} / "
        f"解析不能 {len(unparsed)} / HTTP {fetch.requests} 回",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
