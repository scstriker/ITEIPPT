"""Build the ITEISlides manual PDF (GB/T 7713.3—2014 layout).

    python manual/build/build.py

Steps (manual-writing-prompt section 9):
1 convert Markdown (extended syntax) to HTML; 2 number chapters / figures / tables and resolve
cross references; 3 generate front matter; 4 render with Chromium, locate page markers with
PyMuPDF, back-fill page numbers, repeat until stable (max 6); 5 render cover / back cover;
6 overlay headers and footers; 7 bookmarks, page labels, metadata, attachments, deliver.
"""

from __future__ import annotations

import html
import json
import re
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

import fitz
import markdown
import yaml
from bs4 import BeautifulSoup, NavigableString, Tag
from playwright.sync_api import sync_playwright
from pypinyin import Style, lazy_pinyin

MANUAL = Path(__file__).resolve().parents[1]
BUILD = MANUAL / 'build'
WORK = BUILD / 'work'
SRC = MANUAL / 'src'
OUT = MANUAL / 'out'
SHOTS = MANUAL / 'shots' / 'final'
DIAGRAMS = MANUAL / 'diagrams'
CSS = SRC / 'common' / 'manual.css'

CONFIG = yaml.safe_load((BUILD / 'config.yaml').read_text(encoding='utf-8'))
# YAML folded scalars join lines with a space; Chinese text must not keep it.
_ZH_PUNCT = '[　-〿＀-￯]'
_ZH = '[一-鿿　-〿＀-￯]'
for _key in ('statement', 'abstract_zh'):
    CONFIG[_key] = re.sub(rf'(?<={_ZH}) +(?={_ZH}|\[@)|(?<={_ZH_PUNCT}) +', '', CONFIG[_key])
BOOK = CONFIG['book']
MD_DIR = SRC / BOOK

MD_EXTENSIONS = ['tables', 'attr_list', 'admonition', 'md_in_html', 'fenced_code', 'def_list', 'sane_lists']
MARK = 'QQ{:05d}QQ'
MARK_RE = re.compile(r'QQ(\d{5})QQ')


# ------------------------------------------------------------------ step 1: Markdown -> HTML

INLINE_RULES = [
    (re.compile(r'\[\[(.+?)\]\]'), lambda m: f'<span class="ui">{m.group(1)}</span>'),
    (re.compile(r'\+\+(.+?)\+\+'), lambda m: f'<kbd>{m.group(1)}</kbd>'),
    (re.compile(r'\[@([a-z0-9-]+)\]'), lambda m: f'<a class="xref" data-ref="{m.group(1)}" href="#{m.group(1)}">[@{m.group(1)}]</a>'),
    (re.compile(r'\[#(\d+)\]'), lambda m: f'<sup class="cite"><a href="#ref-{m.group(1)}">[{m.group(1)}]</a></sup>'),
    (re.compile(r'\{\{i:(.+?)\}\}'), lambda m: f'<span class="idx" data-term="{html.escape(m.group(1))}"></span>'),
]
TABLE_CAPTION = re.compile(r'^Table:\s*(.+?)\s*\{#([a-z0-9-]+)(?:\s+cols=([\d,]+))?\}\s*$')


def preprocess(text: str) -> str:
    """Replace the extended syntax outside fenced code blocks and inline code spans."""
    out_lines = []
    in_fence = False
    for line in text.split('\n'):
        if line.lstrip().startswith('```'):
            in_fence = not in_fence
            out_lines.append(line)
            continue
        if in_fence:
            out_lines.append(line)
            continue
        caption = TABLE_CAPTION.match(line.strip())
        if caption:
            title, tid, cols = caption.groups()
            out_lines.append(f'<p class="tblcap-src" data-id="{tid}" data-cols="{cols or ""}">{title}</p>')
            continue
        parts = re.split(r'(`[^`]*`)', line)
        for i, part in enumerate(parts):
            if part.startswith('`') and part.endswith('`') and len(part) > 1:
                continue
            for pattern, repl in INLINE_RULES:
                part = pattern.sub(repl, part)
            parts[i] = part
        out_lines.append(''.join(parts))
    return '\n'.join(out_lines)


def section_kind(path: Path, first_h1_classes: list[str]) -> str:
    for kind in ('appendix', 'refs', 'standalone'):
        if kind in first_h1_classes:
            return kind
    return 'front' if path.name.startswith('0') else 'chapter'


def convert_sources() -> list[tuple[str, Path, str]]:
    sections = []
    for path in sorted(MD_DIR.glob('*.md')):
        raw = path.read_text(encoding='utf-8')
        body = markdown.markdown(preprocess(raw), extensions=MD_EXTENSIONS)
        soup = BeautifulSoup(body, 'html.parser')
        h1 = soup.find('h1')
        kind = section_kind(path, (h1.get('class') or []) if h1 else [])
        sections.append((kind, path, body))
    return sections


# ------------------------------------------------------------------ step 2: numbering

@dataclass
class Target:
    kind: str           # ch / sec / fig / tbl / app / front / refs / index
    label: str          # 第 5 章 / 5.2 / 图 5-2 / 表 5-1 / 附录 A
    title: str
    level: int = 1
    mark: int = -1


@dataclass
class Book:
    soup: BeautifulSoup
    targets: dict[str, Target] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)       # heading ids in document order
    figures: list[str] = field(default_factory=list)
    tables: list[str] = field(default_factory=list)
    index_terms: list[tuple[str, int]] = field(default_factory=list)
    marks: dict[int, str] = field(default_factory=dict)  # mark -> id or 'idx:term'
    body_start_mark: int = -1


def letter(n: int) -> str:
    return chr(ord('A') + n - 1)


def build_book(sections: list[tuple[str, Path, str]]) -> Book:
    soup = BeautifulSoup('<div id="book"></div>', 'html.parser')
    root = soup.find(id='book')
    for kind, path, body in sections:
        sec = soup.new_tag('section', attrs={'class': kind, 'data-file': path.name})
        frag = BeautifulSoup(body, 'html.parser')
        for child in list(frag.contents):
            sec.append(child)
        root.append(sec)
    book = Book(soup)
    seq = [0]

    def new_mark(target_id: str) -> Tag:
        seq[0] += 1
        book.marks[seq[0]] = target_id
        span = soup.new_tag('span', attrs={'class': 'mk'})
        span.string = MARK.format(seq[0])
        return span, seq[0]

    chapter_no = 0
    appendix_no = 0
    for sec in root.find_all('section', recursive=False):
        kind = sec['class'][0]
        h1 = sec.find('h1')
        if kind == 'chapter':
            chapter_no += 1
            prefix = str(chapter_no)
        elif kind == 'appendix':
            appendix_no += 1
            prefix = letter(appendix_no)
        else:
            prefix = None
        fig_no = tbl_no = 0
        h2_no = h3_no = 0
        for el in sec.find_all(['h1', 'h2', 'h3', 'p']):
            if el.name == 'h1':
                hid = el.get('id') or f'auto-{sec["data-file"]}'
                el['id'] = hid
                title = el.get_text().strip()
                if kind == 'chapter':
                    label = f'第 {prefix} 章'
                    num = soup.new_tag('span', attrs={'class': 'num'})
                    num.string = label
                    el.insert(0, num)
                    tkind = 'ch'
                elif kind == 'appendix':
                    label = f'附录 {prefix}'
                    num = soup.new_tag('span', attrs={'class': 'num'})
                    num.string = label
                    el.insert(0, num)
                    tkind = 'app'
                else:
                    label, tkind = '', kind
                mark, m = new_mark(hid)
                el.insert_before(mark)
                book.targets[hid] = Target(tkind, label, title, 1, m)
                book.order.append(hid)
                if kind == 'chapter' and chapter_no == 1:
                    book.body_start_mark = m
            elif el.name in ('h2', 'h3') and prefix and kind in ('chapter', 'appendix'):
                if el.name == 'h2':
                    h2_no += 1
                    h3_no = 0
                    label = f'{prefix}.{h2_no}'
                    level = 2
                else:
                    h3_no += 1
                    label = f'{prefix}.{h2_no}.{h3_no}'
                    level = 3
                hid = el.get('id') or f'auto-{prefix}-{h2_no}-{h3_no}'
                el['id'] = hid
                title = el.get_text().strip()
                num = soup.new_tag('span', attrs={'class': 'num'})
                num.string = label
                el.insert(0, num)
                mark, m = new_mark(hid)
                el.insert_before(mark)
                book.targets[hid] = Target('sec', label, title, level, m)
                book.order.append(hid)
            elif el.name == 'p':
                if 'tblcap-src' in (el.get('class') or []):
                    table = el.find_next_sibling('table')
                    if table is None:
                        raise SystemExit(f'Table caption without table: {el}')
                    tbl_no += 1
                    tid = el['data-id']
                    label = f'表 {prefix}-{tbl_no}' if kind == 'chapter' else f'表 {prefix}{tbl_no}'
                    wrapper = soup.new_tag('div', attrs={'class': 'tbl', 'id': tid})
                    cap = soup.new_tag('p', attrs={'class': 'tblcap'})
                    num = soup.new_tag('span', attrs={'class': 'num'})
                    num.string = label
                    cap.append(num)
                    cap.append(el.get_text().strip())
                    if el.get('data-cols'):
                        colgroup = soup.new_tag('colgroup')
                        for width in el['data-cols'].split(','):
                            colgroup.append(soup.new_tag('col', attrs={'style': f'width:{width}%'}))
                        table.insert(0, colgroup)
                    mark, m = new_mark(tid)
                    el.insert_before(wrapper)
                    wrapper.append(mark)
                    wrapper.append(cap)
                    wrapper.append(table.extract())
                    el.decompose()
                    book.targets[tid] = Target('tbl', label, cap.get_text().replace(label, '', 1).strip(), 1, m)
                    book.tables.append(tid)
                    continue
                imgs = el.find_all('img')
                text_only = el.get_text().strip()
                if imgs and not text_only:
                    fig_no += 1
                    first = imgs[0]
                    fid = first.get('id') or f'fig-auto-{prefix}-{fig_no}'
                    classes = [c for img in imgs for c in (img.get('class') or [])]
                    label = f'图 {prefix}-{fig_no}' if kind == 'chapter' else f'图 {prefix}{fig_no}'
                    fig_classes = sorted(set(classes)) + (['pair'] if len(imgs) > 1 else [])
                    figure = soup.new_tag('figure', attrs={'id': fid, 'class': ' '.join(fig_classes)})
                    mark, m = new_mark(fid)
                    figure.append(mark)
                    caption_text = first.get('alt', '').strip()
                    if len(imgs) > 1:
                        subs = soup.new_tag('div', attrs={'class': 'subs'})
                        for i, img in enumerate(imgs):
                            sub = soup.new_tag('div', attrs={'class': 'sub'})
                            sub.append(make_image(soup, img))
                            subcap = soup.new_tag('div', attrs={'class': 'subcap'})
                            subcap.string = f'（{chr(0x61 + i)}）{img.get("title", "")}'
                            sub.append(subcap)
                            subs.append(sub)
                        figure.append(subs)
                    else:
                        figure.append(make_image(soup, first))
                    cap = soup.new_tag('figcaption')
                    num = soup.new_tag('span', attrs={'class': 'num'})
                    num.string = label
                    cap.append(num)
                    cap.append(caption_text)
                    figure.append(cap)
                    el.replace_with(figure)
                    book.targets[fid] = Target('fig', label, caption_text, 1, m)
                    book.figures.append(fid)
        # index anchors
        for span in sec.find_all('span', class_='idx'):
            term = html.unescape(span['data-term'])
            mark, m = new_mark(f'idx:{term}')
            span.replace_with(mark)
            book.index_terms.append((term, m))
    resolve_xrefs(book)
    return book


def make_image(soup: BeautifulSoup, img: Tag) -> Tag:
    src = img.get('src', '')
    if src.startswith('diagram:'):
        svg_path = DIAGRAMS / f'{src.split(":", 1)[1]}.svg'
        svg = BeautifulSoup(svg_path.read_text(encoding='utf-8'), 'html.parser').find('svg')
        svg['class'] = 'diagram'
        return svg
    if src.startswith('shot:'):
        name = src.split(':', 1)[1]
        path = SHOTS / f'{name}.png'
        if not path.exists():
            raise SystemExit(f'missing screenshot: {path}')
        css_class = 'shot' if not name.startswith('pptx-') else 'slide'
        return soup.new_tag('img', attrs={'src': path.as_uri(), 'class': css_class, 'alt': ''})
    return soup.new_tag('img', attrs={'src': src, 'alt': ''})


def resolve_xrefs(book: Book) -> None:
    for a in book.soup.find_all('a', class_='xref'):
        ref = a['data-ref']
        target = book.targets.get(ref)
        a.string = target.label if target else '??'


def toc_label(t: Target) -> str:
    return f'{t.label}　{t.title}' if t.label else t.title


# ------------------------------------------------------------------ step 3: front matter

def esc(text: str) -> str:
    return html.escape(text or '')


def xref_inline(text: str, book: Book) -> str:
    def repl(m: re.Match) -> str:
        target = book.targets.get(m.group(1))
        return target.label if target else '??'
    return re.sub(r'\[@([a-z0-9-]+)\]', repl, text)


def front_sections(book: Book, pages: dict, labels: list[str], total_pages: int | None) -> str:
    c = CONFIG
    page_of = lambda mark: labels[pages[mark]] if mark in pages and pages[mark] < len(labels) else '?'
    parts = []

    # 题名页
    parts.append(f'''
<section class="front-title" data-front="题名页">
  <span class="mk">{MARK.format(90001)}</span>
  <div class="title-page">
    <div class="meta-row"><span>报告编号：{esc(c["report_number"])}</span><span>密级：{esc(c["classification"])}</span></div>
    <div class="meta-row"><span>报告类型：{esc(c["report_type"])}</span><span></span></div>
    <div class="titles">
      <div class="zh">{esc(c["title"])}</div>
      <div class="zh-sub">{esc(c["subtitle"])}</div>
      <div class="en">{esc(c["title_en"])}<br>{esc(c["subtitle_en"])}</div>
    </div>
    <table class="facts">
      <tr><td>编写单位：</td><td>{esc(c["author"])}</td></tr>
      <tr><td>版　　本：</td><td>{esc(c["version"])}</td></tr>
      <tr><td>完成日期：</td><td>{esc(c["completed"])}</td></tr>
    </table>
    <div class="statement"><span class="label">特别声明</span><p>{esc(c["statement"])}</p></div>
  </div>
</section>''')

    # 辑要页
    rows = [
        ('题名', f'{c["title"]}　{c["subtitle"]}'),
        ('作者及单位', c['author']),
        ('报告类型和起止日期', f'{c["report_type"]}；{c["period"]}'),
        ('辑要页密级', c['classification']),
        ('报告密级', c['classification']),
        ('报告编号', c['report_number'] or '—'),
        ('完成日期', c['completed']),
        ('特别声明', '见题名页'),
        ('摘要', '见摘要页'),
        ('资助机构和计划', c['funding']),
        ('项目名称和编号', f'{c["project"]}；{c["project_number"] or "—"}'),
        ('承担单位', c['organization']),
        ('总页数', f'{total_pages} 页' if total_pages else '?'),
    ]
    trs = ''.join(f'<tr><td class="k">{esc(k)}</td><td>{esc(v)}</td></tr>' for k, v in rows)
    parts.append(f'''
<section class="front" data-front="辑要页"><span class="mk">{MARK.format(90002)}</span>
<h1 id="front-sheet">辑要页</h1>
<table class="abstract-sheet"><colgroup><col style="width:26%"><col style="width:74%"></colgroup><tbody>{trs}</tbody></table>
</section>''')
    return '\n'.join(parts)


def abstract_sections(book: Book) -> str:
    c = CONFIG
    zh = xref_inline(c['abstract_zh'], book)
    kw_zh = '；'.join(c['keywords_zh'])
    kw_en = '; '.join(c['keywords_en'])
    return f'''
<section class="front" data-front="摘要"><span class="mk">{MARK.format(90003)}</span>
<h1 id="front-abstract">摘　　要</h1>
<p>{esc(zh)}</p>
<p class="keywords"><span class="label">关键词：</span>{esc(kw_zh)}</p>
</section>
<section class="front abstract-en" data-front="Abstract"><span class="mk">{MARK.format(90004)}</span>
<h1 id="front-abstract-en">Abstract</h1>
<p>{esc(c["abstract_en"])}</p>
<p class="keywords"><span class="label">Keywords: </span>{esc(kw_en)}</p>
</section>'''


def toc_section(book: Book, pages: dict, labels: list[str]) -> str:
    lines = []
    for hid in book.order:
        t = book.targets[hid]
        if t.kind in ('front',):
            continue
        if t.level > 2:
            continue
        page = labels[pages[t.mark]] if t.mark in pages else '?'
        cls = 'l1' if t.level == 1 else 'l2'
        lines.append(f'<p class="toc-line {cls}"><a class="t" href="#{hid}">{esc(toc_label(t))}</a><span class="dots"></span><span class="p">{page}</span></p>')
    idx_page = labels[pages[90008]] if 90008 in pages else '?'
    lines.append(f'<p class="toc-line l1"><a class="t" href="#index">索　　引</a><span class="dots"></span><span class="p">{idx_page}</span></p>')
    return f'''
<section class="front" data-front="目次"><span class="mk">{MARK.format(90005)}</span>
<h1 id="front-toc">目　　次</h1>
{''.join(lines)}
</section>'''


def lists_sections(book: Book, pages: dict, labels: list[str]) -> str:
    def block(ids: list[str]) -> str:
        out = []
        for tid in ids:
            t = book.targets[tid]
            page = labels[pages[t.mark]] if t.mark in pages else '?'
            out.append(f'<p class="toc-line"><a class="t" href="#{tid}">{esc(t.label)}　{esc(t.title)}</a><span class="dots"></span><span class="p">{page}</span></p>')
        return ''.join(out)
    return f'''
<section class="lists" data-front="插图清单"><span class="mk">{MARK.format(90006)}</span>
<h1 id="front-lof">插图清单</h1>{block(book.figures)}</section>
<section class="lists" data-front="附表清单"><span class="mk">{MARK.format(90007)}</span>
<h1 id="front-lot">附表清单</h1>{block(book.tables)}</section>'''


def index_section(book: Book, pages: dict, labels: list[str]) -> str:
    entries: dict[str, dict[str, list[str]]] = {}
    for term, mark in book.index_terms:
        protected = term.replace('GB/T', 'GB∕T')
        main, _, sub = protected.partition('/')
        main = main.replace('GB∕T', 'GB/T')
        sub = sub.replace('GB∕T', 'GB/T')
        page = labels[pages[mark]] if mark in pages else '?'
        bucket = entries.setdefault(main, {})
        lst = bucket.setdefault(sub, [])
        if page not in lst:
            lst.append(page)

    def key(term: str) -> str:
        return ''.join(lazy_pinyin(term, style=Style.NORMAL)).lower()

    groups: dict[str, list[str]] = {}
    for main in sorted(entries, key=key):
        initial = key(main)[:1].upper()
        if not initial.isalpha():
            initial = '#'
        groups.setdefault(initial, []).append(main)
    out = []
    for initial in sorted(groups):
        out.append(f'<div class="index-group"><h2>{initial}</h2>')
        for main in groups[initial]:
            subs = entries[main]
            main_pages = '，'.join(subs.get('', []))
            out.append(f'<p class="index-entry">{esc(main)}{"　" + main_pages if main_pages else ""}</p>')
            for sub in sorted((s for s in subs if s), key=key):
                out.append(f'<p class="index-entry sub">{esc(sub)}　{"，".join(subs[sub])}</p>')
        out.append('</div>')
    return f'''
<section class="index-section" data-front="索引"><span class="mk">{MARK.format(90008)}</span>
<h1 id="index">索　　引</h1>
<div class="index-cols">{''.join(out)}</div>
</section>'''


# ------------------------------------------------------------------ step 4: render

def roman(n: int) -> str:
    vals = [(1000, 'M'), (900, 'CM'), (500, 'D'), (400, 'CD'), (100, 'C'), (90, 'XC'), (50, 'L'), (40, 'XL'), (10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]
    out = ''
    for v, s in vals:
        while n >= v:
            out += s
            n -= v
    return out


def assemble(book: Book, pages: dict, labels: list[str], total: int | None, blank_before_body: bool) -> str:
    body = BeautifulSoup(str(book.soup), 'html.parser').find(id='book')
    sections = body.find_all('section', recursive=False)
    front_md = [s for s in sections if 'front' in s['class']]
    rest = [s for s in sections if 'front' not in s['class']]
    preface = ''.join(str(s) for s in front_md if s['data-file'].startswith('00'))
    symbols = ''.join(str(s) for s in front_md if not s['data-file'].startswith('00'))
    chapters = ''.join(str(s) for s in rest)
    blank = '<div class="blank-page"></div>' if blank_before_body else ''
    css = CSS.read_text(encoding='utf-8')
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>{css}</style></head><body>
{front_sections(book, pages, labels, total)}
{preface}
{abstract_sections(book)}
{toc_section(book, pages, labels)}
{lists_sections(book, pages, labels)}
{symbols}
{blank}
{chapters}
{index_section(book, pages, labels)}
</body></html>'''


def render_pdf(browser, html_text: str, path: Path, margin: bool = True) -> None:
    html_path = path.with_suffix('.html')
    html_path.write_text(html_text, encoding='utf-8')
    page = browser.new_page()
    page.goto(html_path.as_uri(), wait_until='networkidle')
    page.pdf(
        path=str(path),
        format='A4',
        print_background=True,
        prefer_css_page_size=True,
        margin=None if margin else {'top': '0', 'right': '0', 'bottom': '0', 'left': '0'},
    )
    page.close()


def find_marks(pdf_path: Path) -> tuple[dict[int, int], int]:
    doc = fitz.open(pdf_path)
    found: dict[int, int] = {}
    for index, page in enumerate(doc):
        for m in MARK_RE.finditer(page.get_text('text')):
            found.setdefault(int(m.group(1)), index)
    return found, doc.page_count


def page_labels(page_count: int, body_start: int) -> list[str]:
    return [roman(i + 1) if i < body_start else str(i - body_start + 1) for i in range(page_count)]


# ------------------------------------------------------------------ step 5: cover / back cover

def cover_html() -> str:
    c = CONFIG
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 0; }}
html, body {{ margin: 0; font-family: 'Times New Roman', 'SimSun', serif; color: #1f2a37; -webkit-print-color-adjust: exact; }}
.page {{ width: 210mm; height: 297mm; position: relative; overflow: hidden; }}
.band {{ position: absolute; left: 0; top: 0; width: 210mm; height: 92mm; background: #0f3f70; }}
.slash {{ position: absolute; left: 132mm; top: 0; width: 16mm; height: 92mm; background: #c8102e; transform: skewX(-24deg); }}
.meta {{ position: absolute; top: 14mm; left: 22mm; right: 22mm; display: flex; justify-content: space-between; color: #fff; font-family: 'Arial','SimHei',sans-serif; font-size: 10.5pt; }}
.titles {{ position: absolute; top: 112mm; left: 22mm; right: 22mm; }}
.zh {{ font-family: 'Arial','SimHei',sans-serif; font-size: 22pt; color: #0f3f70; line-height: 1.4; }}
.zh-sub {{ font-size: 18pt; color: #0f3f70; margin-top: 5mm; }}
.en {{ font-size: 14pt; color: #0f3f70; margin-top: 10mm; font-family: 'Times New Roman', serif; }}
.rule {{ width: 60mm; height: 1.2pt; background: #c8102e; margin-top: 10mm; }}
.facts {{ position: absolute; left: 22mm; bottom: 34mm; font-size: 11pt; line-height: 2; }}
.facts span {{ font-family: 'Arial','SimHei',sans-serif; color: #0f3f70; }}
.org {{ position: absolute; left: 22mm; right: 22mm; bottom: 14mm; font-family: 'Arial','SimHei',sans-serif; font-size: 12pt; color: #0f3f70; border-top: 0.8pt solid #0f3f70; padding-top: 4mm; }}
</style></head><body><div class="page">
<div class="band"></div><div class="slash"></div>
<div class="meta"><span>报告编号：{esc(c["report_number"])}</span><span>密级：{esc(c["classification"])}</span></div>
<div class="titles"><div class="zh">{esc(c["title"])}</div><div class="zh-sub">{esc(c["subtitle"])}</div>
<div class="en">{esc(c["title_en"])}<br>{esc(c["subtitle_en"])}</div><div class="rule"></div></div>
<div class="facts">
<div><span>作　　者：</span>{esc(c["author"])}</div>
<div><span>报告类型：</span>{esc(c["report_type"])}</div>
<div><span>版　　本：</span>{esc(c["version"])}</div>
<div><span>完成日期：</span>{esc(c["completed"])}</div>
<div><span>适用环境：</span>{esc(c["environment"])}</div>
</div>
<div class="org">{esc(c["organization"])}</div>
</div></body></html>'''


def back_cover_html() -> str:
    c = CONFIG
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 0; }}
html, body {{ margin: 0; -webkit-print-color-adjust: exact; }}
.page {{ width: 210mm; height: 297mm; position: relative; overflow: hidden; background: #fff; }}
.band {{ position: absolute; left: 0; bottom: 0; width: 210mm; height: 40mm; background: #0f3f70; }}
.slash {{ position: absolute; left: 150mm; bottom: 0; width: 12mm; height: 40mm; background: #c8102e; transform: skewX(-24deg); }}
.org {{ position: absolute; left: 22mm; bottom: 14mm; color: #fff; font-family: 'Arial','SimHei',sans-serif; font-size: 12pt; }}
.title {{ position: absolute; left: 22mm; bottom: 24mm; color: #fff; font-family: 'Arial','SimHei',sans-serif; font-size: 10pt; }}
</style></head><body><div class="page"><div class="band"></div><div class="slash"></div>
<div class="title">{esc(c["header_title"])}</div><div class="org">{esc(c["organization"])}</div></div></body></html>'''


# ------------------------------------------------------------------ step 6: header / footer overlay

def overlay_html(page_count: int, labels: list[str], running: list[str], blank: set[int]) -> str:
    c = CONFIG
    pages = []
    for i in range(page_count):
        if i in blank:
            pages.append('<div class="pg"></div>')
            continue
        # The title page carries only its page number, like the cover carries nothing.
        header = '' if running[i] == '题名页' else f'<div class="hd"><span>{esc(c["header_title"])}</span><span>{esc(running[i])}</span></div>'
        pages.append(f'''<div class="pg">{header}
<div class="ft">{labels[i]}</div></div>''')
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 0; }}
html, body {{ margin: 0; }}
.pg {{ width: 210mm; height: 297mm; position: relative; break-after: page; }}
.hd {{ position: absolute; left: 25mm; right: 20mm; top: 13mm; display: flex; justify-content: space-between;
       font-family: 'Arial','SimHei',sans-serif; font-size: 8.5pt; color: #0f3f70; padding-bottom: 1.5mm; border-bottom: 0.6pt solid #0f3f70; }}
.ft {{ position: absolute; left: 25mm; right: 20mm; bottom: 9mm; text-align: center; font-family: 'Times New Roman', serif; font-size: 9pt; color: #1f2a37; }}
</style></head><body>{''.join(pages)}</body></html>'''


# ------------------------------------------------------------------ step 7: finish

def utf16_hex(text: str) -> str:
    return '<FEFF' + text.encode('utf-16-be').hex().upper() + '>'


def strip_marks(doc: fitz.Document) -> int:
    """Remove the 1 px page-marker text after pagination; tiny per-glyph redactions leave neighbours intact."""
    count = 0
    for page in doc:
        hits = 0
        for block in page.get_text('rawdict')['blocks']:
            for line in block.get('lines', []):
                for span in line['spans']:
                    text = ''.join(c['c'] for c in span['chars'])
                    for m in MARK_RE.finditer(text):
                        for c in span['chars'][m.start():m.end()]:
                            r = fitz.Rect(c['bbox'])
                            cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
                            page.add_redact_annot(fitz.Rect(cx - 0.05, cy - 0.05, cx + 0.05, cy + 0.05))
                        hits += 1
        if hits:
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
            count += hits
    return count


def set_page_labels(doc: fitz.Document, body_start_physical: int) -> None:
    last = doc.page_count - 1
    nums = (
        f'0 << /P {utf16_hex("封面")} >> '
        f'1 << /S /R /St 1 >> '
        f'{body_start_physical} << /S /D /St 1 >> '
        f'{last} << /P {utf16_hex("封底")} >>'
    )
    doc.xref_set_key(doc.pdf_catalog(), 'PageLabels', f'<< /Nums [ {nums} ] >>')


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')  # Chinese output on a GBK console
    WORK.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    book = build_book(convert_sources())
    ids = [el.get('id') for el in book.soup.find_all(id=True)]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise SystemExit(f'duplicate ids: {dupes}')

    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome')
        pages: dict[int, int] = {}
        labels: list[str] = []
        total: int | None = None
        blank = False
        previous = None
        main_pdf = WORK / 'main.pdf'
        for iteration in range(1, 7):
            render_pdf(browser, assemble(book, pages, labels, total, blank), main_pdf)
            pages, count = find_marks(main_pdf)
            body_start = pages[book.body_start_mark]
            labels = page_labels(count, body_start)
            total = count + 2
            if (body_start + 2) % 2 == 0:  # physical page = index + 2 (cover first); body must start on an odd page
                blank = not blank
                previous = None
                print(f'iteration {iteration}: {"inserting" if blank else "removing"} the blank page before the body')
                continue
            state = json.dumps([pages, total], sort_keys=True)
            print(f'iteration {iteration}: {count} pages, body starts at index {body_start}')
            if state == previous:
                break
            previous = state
        else:
            print('warning: page numbers did not converge in 6 iterations')

        render_pdf(browser, cover_html(), WORK / 'cover.pdf', margin=False)
        render_pdf(browser, back_cover_html(), WORK / 'back.pdf', margin=False)

        # running heads
        heads = sorted(
            [(pages[t.mark], t.title if not t.label else f'{t.label}　{t.title}') for t in book.targets.values()
             if t.kind not in ('fig', 'tbl', 'sec') and t.level == 1 and t.mark in pages]
            + [(pages[m], name) for m, name in [(90001, '题名页'), (90002, '辑要页'), (90003, '摘要'), (90004, 'Abstract'), (90005, '目次'), (90006, '插图清单'), (90007, '附表清单'), (90008, '索引')] if m in pages]
        )
        running = []
        current = ''
        for i in range(len(labels)):
            for page_index, name in heads:
                if page_index == i:
                    current = name
            running.append(current)
        blank_pages = set()
        main_doc = fitz.open(main_pdf)
        for i, page in enumerate(main_doc):
            text = MARK_RE.sub('', page.get_text('text')).strip()
            if not text and not page.get_images():
                blank_pages.add(i)
        render_pdf(browser, overlay_html(len(labels), labels, running, blank_pages), WORK / 'overlay.pdf', margin=False)
        browser.close()

    print(f'removed {strip_marks(main_doc)} page markers')
    overlay = fitz.open(WORK / 'overlay.pdf')
    for i, page in enumerate(main_doc):
        page.show_pdf_page(page.rect, overlay, i, overlay=True)

    final = fitz.open()
    final.insert_pdf(fitz.open(WORK / 'cover.pdf'))
    final.insert_pdf(main_doc)
    final.insert_pdf(fitz.open(WORK / 'back.pdf'))

    # bookmarks (levels increase one step at a time)
    toc = []
    front_names = [(90002, '辑要页'), (90003, '摘要'), (90004, 'Abstract'), (90005, '目次'), (90006, '插图清单'), (90007, '附表清单')]
    entries = [(pages[m], 1, n) for m, n in front_names if m in pages]
    for hid in book.order:
        t = book.targets[hid]
        if t.level > 2 or t.mark not in pages:
            continue
        entries.append((pages[t.mark], t.level, toc_label(t)))
    if 90008 in pages:
        entries.append((pages[90008], 1, '索引'))
    entries.sort(key=lambda e: e[0])
    last_level = 0
    for page_index, level, title in entries:
        level = min(level, last_level + 1)
        toc.append([level, title, page_index + 2])
        last_level = level
    final.set_toc(toc)

    body_start_physical = pages[book.body_start_mark] + 1  # 0-based index in final document
    set_page_labels(final, body_start_physical)
    c = CONFIG
    final.set_metadata({
        'title': f'{c["title"]} {c["subtitle"]}',
        'author': c['author'],
        'subject': c['report_type'],
        'keywords': '；'.join(c['keywords_zh']),
        'creator': 'manual/build/build.py',
        'producer': 'Chromium + PyMuPDF',
    })
    for item in c.get('attachments', []):
        path = (BUILD / item['path']).resolve()
        final.embfile_add(path.name, path.read_bytes(), filename=path.name, desc=item['description'])
    out = OUT / c['output']
    final.save(out, garbage=3, deflate=True)
    deliver = (BUILD / c['deliver_to']).resolve()
    shutil.copyfile(out, deliver)
    (WORK / 'build-info.json').write_text(json.dumps({
        'pages': final.page_count,
        'body_start_physical': body_start_physical + 1,
        'figures': len(book.figures),
        'tables': len(book.tables),
        'total_reported': total,
        'blank_before_body': blank,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'wrote {out} ({final.page_count} pages, {len(book.figures)} figures, {len(book.tables)} tables) -> {deliver}')


if __name__ == '__main__':
    main()
