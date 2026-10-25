"""Check the built manual (manual-writing-prompt section 10).

    python manual/build/check.py            # all checks + thumbnails
    python manual/build/check.py --no-thumbs

Errors make the exit code 1; warnings are printed for review.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import fitz
import yaml
from PIL import Image
from pypdf import PdfReader

MANUAL = Path(__file__).resolve().parents[1]
REPO = MANUAL.parent
BUILD = MANUAL / 'build'
CONFIG = yaml.safe_load((BUILD / 'config.yaml').read_text(encoding='utf-8'))
MD_DIR = MANUAL / 'src' / CONFIG['book']
PDF = MANUAL / 'out' / CONFIG['output']
PREVIEW = MANUAL / 'out' / 'preview'
APP_SOURCES = [REPO / 'src' / d for d in ('app', 'components', 'confirm', 'features', 'services', 'template', 'workflow')]

errors: list[str] = []
warnings: list[str] = []


def error(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def strip_code(text: str) -> str:
    """Blank out fenced code blocks and inline code so syntax inside them is ignored."""
    text = re.sub(r'```.*?```', lambda m: '\n' * m.group(0).count('\n'), text, flags=re.S)
    return re.sub(r'`[^`\n]*`', '', text)


def sources() -> dict[str, str]:
    return {p.name: p.read_text(encoding='utf-8') for p in sorted(MD_DIR.glob('*.md'))}


# ------------------------------------------------------------------ PDF checks

def check_pdf() -> fitz.Document:
    doc = fitz.open(PDF)
    residue = [
        (r'\[\[|\]\]', '界面文字标记'),
        (r'\{\{i:', '索引标记'),
        (r'\[@', '交叉引用标记'),
        (r'QQ\d{5}QQ', '页码标记文字'),
        (r'\?\?', '未解析的交叉引用'),
        (r'None\d', '编号缺少前缀'),
    ]
    for i, page in enumerate(doc):
        text = page.get_text('text')
        for pattern, name in residue:
            for m in re.finditer(pattern, text):
                error(f'PDF 第 {i + 1} 页残留{name}：{text[max(0, m.start() - 15):m.end() + 15]!r}')
        for line in text.splitlines():
            if re.search(r'\.\s*\?$', line) or line.strip() == '?':
                error(f'PDF 第 {i + 1} 页有占位页码：{line!r}')
    fonts = {}
    for page in doc:
        for xref, ext, ftype, basefont, *_ in page.get_fonts(full=True):
            fonts[basefont] = (ext, ftype)
    for name, (ext, ftype) in sorted(fonts.items()):
        if ftype == 'Type3':
            error(f'Type3 字体：{name}')
        if ext == 'n/a':
            error(f'字体未嵌入：{name}')
    print(f'字体（{len(fonts)}）：' + '，'.join(sorted({re.sub(r"^[A-Z]{6}\+", "", n) for n in fonts})))
    return doc


def check_labels(doc: fitz.Document) -> None:
    info = json.loads((BUILD / 'work' / 'build-info.json').read_text(encoding='utf-8'))
    start = info['body_start_physical']
    if start % 2 == 0:
        error(f'正文从第 {start} 物理页开始，不是奇数页')
    labels = PdfReader(str(PDF)).page_labels
    expect_first, expect_last = '封面', '封底'
    if labels[0] != expect_first or labels[-1] != expect_last:
        error(f'封面、封底的页面标签不对：{labels[0]!r}、{labels[-1]!r}')
    if labels[1] != 'I':
        error(f'题名页的页面标签应为 I，实际 {labels[1]!r}')
    if labels[start - 1] != '1':
        error(f'正文首页的页面标签应为 1，实际 {labels[start - 1]!r}')
    # printed page numbers must match labels (footer text on every non-blank body page)
    for i in range(1, doc.page_count - 1):
        page = doc[i]
        words = page.get_text('words')
        if not words:
            continue
        footer = [w[4] for w in words if w[1] > page.rect.height - 40]
        if labels[i] not in footer:
            error(f'第 {i + 1} 物理页：页脚 {footer} 与页面标签 {labels[i]!r} 不一致')
    total = doc.page_count
    sheet = next((p for p in doc if '辑要页' in p.get_text('text') and '总页数' in p.get_text('text')), None)
    if sheet is None:
        error('找不到辑要页')
    else:
        m = re.search(r'总页数\s*(\d+)\s*页', sheet.get_text('text'))
        if not m or int(m.group(1)) != total:
            error(f'辑要页的总页数 {m.group(1) if m else "?"} 与实际页数 {total} 不一致')
    print(f'页数 {total}，正文起始物理页 {start}，图 {info["figures"]} 幅，表 {info["tables"]} 张')


# ------------------------------------------------------------------ source checks

def app_text() -> str:
    parts = []
    for root in APP_SOURCES:
        for path in root.rglob('*'):
            if path.suffix in ('.ts', '.tsx') and 'node_modules' not in path.parts:
                parts.append(path.read_text(encoding='utf-8'))
    return '\n'.join(parts)


def check_ui_strings(src: dict[str, str]) -> None:
    corpus = app_text()
    missing = set()
    for name, text in src.items():
        for m in re.finditer(r'\[\[(.+?)\]\]', strip_code(text)):
            if m.group(1) not in corpus:
                missing.add((name, m.group(1)))
    for name, ui in sorted(missing):
        error(f'{name}：界面文字 [[{ui}]] 在源码中搜不到')


def check_ids(src: dict[str, str]) -> None:
    defined: dict[str, str] = {}
    for name, text in src.items():
        body = strip_code(text)
        for m in re.finditer(r'\{[^}\n]*?#([a-z0-9-]+)[^}\n]*\}', body):
            iid = m.group(1)
            if iid in defined:
                error(f'ID 重复：{iid}（{defined[iid]}、{name}）')
            defined[iid] = name
    refs = set(int(n) for n in re.findall(r'#ref-(\d+)', ''.join(src.values())))
    first_cite: list[int] = []
    for name, text in src.items():
        body = strip_code(text)
        for m in re.finditer(r'\[@([a-z0-9-]+)\]', body):
            if m.group(1) not in defined:
                error(f'{name}：交叉引用 [@{m.group(1)}] 没有对应的 ID')
        for m in re.finditer(r'\[#(\d+)\]', body):
            n = int(m.group(1))
            if n not in refs:
                error(f'{name}：引用了不存在的参考文献 [{n}]')
            if n not in first_cite:
                first_cite.append(n)
    if first_cite != sorted(first_cite):
        error(f'参考文献没有按首次引用的顺序编号：{first_cite}')
    unused = sorted(refs - set(first_cite))
    if unused:
        error(f'参考文献没有在正文中引用：{unused}')
    # a figure is cited before it appears; every figure and table is cited somewhere
    all_text = '\n'.join(strip_code(t) for t in src.values())
    for name, text in src.items():
        body = strip_code(text)
        for m in re.finditer(r'\{#((?:fig|tbl)-[a-z0-9-]+)', body):
            iid = m.group(1)
            cite = f'[@{iid}]'
            if cite not in all_text:
                warn(f'{name}：{iid} 没有在正文中引用')
            elif iid.startswith('fig-') and body.find(cite) > m.start() and cite in body:
                line = body.count('\n', 0, m.start()) + 1
                warn(f'{name}:{line}：{iid} 在引用之前出现')
    print(f'ID {len(defined)} 个，参考文献 {len(refs)} 条')


AI_PHRASES = [
    '随着', '在当今', '值得注意的是', '需要指出的是', '让我们', '接下来我们将', '总的来说', '综上所述', '总而言之',
    '希望对你有帮助', '如有问题', '不仅', '与其', '赋能', '抓手', '闭环', '沉淀', '颗粒度', '底层逻辑', '范式', '打通',
    '强大', '无缝', '极致', '优雅', '轻松', '一站式', '进行', '通过……的方式', '作为一个', '在某种程度上', '！', '——',
]
CJK = r'[一-鿿]'


def visible_lines(text: str):
    """Yield (line number, text) with markup, quoted UI strings and IDs removed."""
    body = strip_code(text)
    for no, line in enumerate(body.split('\n'), 1):
        line = re.sub(r'\{[^}]*\}', '', line)            # attribute lists, IDs, index markers
        line = re.sub(r'\[\[[^\]]*\]\]', '界', line)       # UI text is quoted verbatim
        line = re.sub(r'“[^”]*”', '“”', line)             # quoted messages are verbatim too
        line = re.sub(r'\[@[a-z0-9-]+\]', ' 引 ', line)
        line = re.sub(r'\[#\d+\]', '', line)
        line = re.sub(r'\]\([^)]*\)', ']', line)
        line = re.sub(r'\+\+[^+]+\+\+', ' 键 ', line)
        yield no, line


# UI names written without spaces in the app, used in headings and captions as-is.
UI_TOKENS = ['AI补充']
# Files whose punctuation follows another rule: GB/T 7714 references; verbatim UI messages.
HALF_WIDTH_OK = {'90-refs.md'}
VERBATIM_OK = {'92-app-messages.md'}


def check_style(src: dict[str, str]) -> None:
    for name, text in src.items():
        # section references render as bare numbers such as 7.4, so they need spaces next to Chinese text
        for m in re.finditer(rf'{CJK}\[@sec-|\[@(?:sec|fig|tbl|app)-[a-z0-9-]+\]{CJK}|\[@ch-[a-z0-9-]+\] {CJK}', strip_code(text)):
            line = strip_code(text).count('\n', 0, m.start()) + 1
            warn(f'{name}:{line}：交叉引用与汉字之间的空格不对')
        for no, line in visible_lines(text):
            for token in UI_TOKENS:
                line = line.replace(token, '界')
            for phrase in AI_PHRASES:
                if phrase in line:
                    warn(f'{name}:{no}：AI 腔“{phrase}”')
            for m in re.finditer(rf'{CJK}[A-Za-z0-9]|[A-Za-z0-9]{CJK}', line):
                ctx = line[max(0, m.start() - 6):m.end() + 6]
                warn(f'{name}:{no}：中英文或数字之间缺空格：{ctx!r}')
            if name in HALF_WIDTH_OK:
                continue
            for m in re.finditer(rf'{CJK}[,;:?!()]|[,;:?!()]{CJK}', line):
                ctx = line[max(0, m.start() - 6):m.end() + 6]
                warn(f'{name}:{no}：中文句子中用了半角标点：{ctx!r}')
            if '...' in line and name not in VERBATIM_OK:
                warn(f'{name}:{no}：用了 ... 而不是 ……')


# ------------------------------------------------------------------ thumbnails

def thumbnails(doc: fitz.Document) -> None:
    PREVIEW.mkdir(parents=True, exist_ok=True)
    for old in PREVIEW.glob('sheet-*.png'):
        old.unlink()
    labels = PdfReader(str(PDF)).page_labels
    tiles = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=40)
        tiles.append((Image.frombytes('RGB', (pix.width, pix.height), pix.samples), labels[i]))
    w, h = tiles[0][0].size
    gap = 12
    for s in range(0, len(tiles), 9):
        sheet = Image.new('RGB', (3 * w + 4 * gap, 3 * h + 4 * gap), (150, 150, 150))
        for k, (img, _) in enumerate(tiles[s:s + 9]):
            sheet.paste(img, (gap + (k % 3) * (w + gap), gap + (k // 3) * (h + gap)))
        sheet.save(PREVIEW / f'sheet-{s // 9 + 1:02d}.png')
    print(f'缩略图：{PREVIEW}（{(len(tiles) + 8) // 9} 张）')


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')  # Chinese output on a GBK console
    doc = check_pdf()
    check_labels(doc)
    src = sources()
    check_ui_strings(src)
    check_ids(src)
    check_style(src)
    if '--no-thumbs' not in sys.argv:
        thumbnails(doc)
    for w in warnings:
        print('警告：' + w)
    for e in errors:
        print('错误：' + e)
    print(f'错误 {len(errors)} 条，警告 {len(warnings)} 条')
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
