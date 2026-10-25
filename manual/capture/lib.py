"""Shared capture helpers: servers, browser, page helpers and the shot recorder.

Screenshots come from the real production build. The backend is the real HTTP app with
in-memory jobs; only Gemini is a scripted local mock (manual/capture/mockBackend.ts).
Crop and annotation boxes are stored in shots/meta.json; annotate.py draws them.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import Locator, Page, expect

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'src'
MANUAL = ROOT / 'manual'
FIXTURES = MANUAL / 'fixtures' / 'out'
RAW = MANUAL / 'shots' / 'raw'
META_PATH = MANUAL / 'shots' / 'meta.json'
WEB_DIST = MANUAL / 'build' / 'web-dist'

API_PORT, CONTROL_PORT, GEMINI_PORT, WEB_PORT = 8791, 8792, 8793, 4180
BASE_URL = f'http://127.0.0.1:{WEB_PORT}'
# 1024 px wide: 13 px UI text prints at about 6.5 pt when a full-width crop fills the 170 mm text block.
VIEWPORT = {'width': 1024, 'height': 900}
DPR = 2

SAMPLE_DOCX = FIXTURES / '压力传感器标准编制说明（示例）.docx'
SAMPLE_SCAN = FIXTURES / '扫描件（示例）.pdf'
SAMPLE_DOC = FIXTURES / '旧版文档（示例）.doc'
SAMPLE_IMAGES = sorted(FIXTURES.glob('配图-*（示例）.png'))
SAMPLE_PRESENTER = '张明（示例）'


# ---------------------------------------------------------------- servers

def _wait_http(url: str, timeout: float = 120) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2):
                return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f'timeout waiting for {url}')


def _kill_tree(proc: subprocess.Popen) -> None:
    subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True)


@contextmanager
def servers(build: bool = True):
    """Build the web app, start the mock backend and the preview server; stop only what we started."""
    if build:
        subprocess.run(
            f'npx vite build --outDir "{WEB_DIST}" --emptyOutDir',
            cwd=SRC, shell=True, check=True, capture_output=True,
        )
    env = {
        **os.environ,
        'MANUAL_API_PORT': str(API_PORT),
        'MANUAL_CONTROL_PORT': str(CONTROL_PORT),
        'MANUAL_GEMINI_PORT': str(GEMINI_PORT),
        'API_PROXY_TARGET': f'http://127.0.0.1:{API_PORT}',
    }
    log = open(MANUAL / 'build' / 'servers.log', 'w', encoding='utf-8')
    mock = subprocess.Popen('npx tsx ../manual/capture/mockBackend.ts', cwd=SRC, shell=True, env=env, stdout=log, stderr=log)
    preview = subprocess.Popen(
        f'npx vite preview --outDir "{WEB_DIST}" --port {WEB_PORT} --strictPort --host 127.0.0.1',
        cwd=SRC, shell=True, env=env, stdout=log, stderr=log,
    )
    try:
        _wait_http(f'http://127.0.0.1:{API_PORT}/api/health')
        _wait_http(BASE_URL)
        yield
    finally:
        _kill_tree(preview)
        _kill_tree(mock)
        log.close()


def set_scenario(**scenario) -> None:
    request = urllib.request.Request(
        f'http://127.0.0.1:{CONTROL_PORT}/scenario',
        data=json.dumps(scenario).encode('utf-8'),
        headers={'content-type': 'application/json'},
        method='POST',
    )
    urllib.request.urlopen(request, timeout=5).read()


# ---------------------------------------------------------------- page helpers

def settle(page: Page, ms: int = 250) -> None:
    """Wait for CSS transitions / dialog animations to finish."""
    page.evaluate('() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null)))')
    page.wait_for_timeout(ms)


def confirm(page: Page, title: str, button: str, wait_closed: bool = True) -> None:
    heading = page.get_by_role('heading', name=title, exact=True)
    expect(heading).to_be_visible()
    page.get_by_role('button', name=button, exact=True).click()
    if wait_closed:
        expect(heading).to_be_hidden(timeout=60_000)


def go_next(page: Page) -> None:
    page.get_by_role('button', name='下一步 →').click()
    confirm(page, '确认进入下一步？', '进入下一步')


def upload(page: Page, path: Path = SAMPLE_DOCX) -> None:
    page.get_by_label('点击选择文档').set_input_files(str(path))


def upload_and_wait(page: Page, path: Path = SAMPLE_DOCX) -> None:
    upload(page, path)
    expect(page.get_by_text('文档已解析并可进入下一步。')).to_be_visible()


def open_framework(page: Page, preset: str | None = '标准审查汇报') -> None:
    page.goto(BASE_URL)
    page.get_by_label('汇报人').fill(SAMPLE_PRESENTER)
    upload_and_wait(page)
    go_next(page)
    if preset:
        page.get_by_label('预设模板').select_option(label=preset)


def ai_suggest(page: Page) -> None:
    page.get_by_role('button', name='AI 建议调整').click()
    confirm(page, '确认执行 AI 建议调整？', '开始分析')


def generate(page: Page) -> None:
    page.get_by_role('button', name='开始生成内容').click()
    confirm(page, '确认开始生成内容？', '开始生成')
    expect(page.get_by_text('已生成页数：')).to_be_visible(timeout=60_000)


def chapter_rows(page: Page) -> Locator:
    return page.get_by_role('row').filter(has=page.get_by_role('spinbutton'))


def card(page: Page, title: str) -> Locator:
    """The ITEI Card whose header title is `title`."""
    return page.locator('section').filter(has=page.get_by_role('heading', name=title, exact=True)).first


# ---------------------------------------------------------------- recorder

def _load_meta() -> dict:
    if META_PATH.exists():
        return json.loads(META_PATH.read_text(encoding='utf-8'))
    return {}


class Recorder:
    """Takes viewport screenshots and records crop / annotation boxes (CSS px)."""

    def __init__(self, page: Page):
        self.page = page
        self.meta = _load_meta()
        RAW.mkdir(parents=True, exist_ok=True)

    def _page_box(self, target) -> dict:
        if isinstance(target, dict):
            return target
        box = target.bounding_box()
        if box is None:
            raise RuntimeError(f'not visible: {target}')
        scroll = self.page.evaluate('() => [window.scrollX, window.scrollY]')
        return {'x': box['x'] + scroll[0], 'y': box['y'] + scroll[1], 'width': box['width'], 'height': box['height']}

    def shot(self, name: str, region: list, marks: list | None = None, pad: int = 12, note: str = '') -> None:
        """region / marks: Locators or page-coordinate boxes. Marks are numbered in order."""
        page = self.page
        settle(page)
        boxes = [self._page_box(item) for item in region]
        left = min(b['x'] for b in boxes) - pad
        top = min(b['y'] for b in boxes) - pad
        right = max(b['x'] + b['width'] for b in boxes) + pad
        bottom = max(b['y'] + b['height'] for b in boxes) + pad
        height_needed = int(bottom - top) + 2
        resized = height_needed > VIEWPORT['height']
        if resized:
            page.set_viewport_size({'width': VIEWPORT['width'], 'height': min(height_needed + 40, 6000)})
            settle(page)
            boxes = [self._page_box(item) for item in region]
            top = min(b['y'] for b in boxes) - pad
            bottom = max(b['y'] + b['height'] for b in boxes) + pad
        page.evaluate('(y) => window.scrollTo(0, y)', max(0, top))
        settle(page, 150)
        scroll_y = page.evaluate('() => window.scrollY')
        mark_boxes = [self._page_box(item) for item in (marks or [])]
        boxes = [self._page_box(item) for item in region]
        left = max(0, min(b['x'] for b in boxes) - pad)
        top = max(0, min(b['y'] for b in boxes) - pad)
        right = min(page.viewport_size['width'], max(b['x'] + b['width'] for b in boxes) + pad)
        bottom = max(b['y'] + b['height'] for b in boxes) + pad
        path = RAW / f'{name}.png'
        page.screenshot(path=str(path))
        to_view = lambda b: [round(b['x'], 1), round(b['y'] - scroll_y, 1), round(b['width'], 1), round(b['height'], 1)]
        self.meta[name] = {
            'raw': f'raw/{name}.png',
            'dpr': DPR,
            'crop': [round(left, 1), round(top - scroll_y, 1), round(right - left, 1), round(bottom - top, 1)],
            'marks': [to_view(b) for b in mark_boxes],
            'note': note,
        }
        META_PATH.write_text(json.dumps(self.meta, ensure_ascii=False, indent=2), encoding='utf-8')
        if resized:
            page.set_viewport_size(VIEWPORT)
            settle(page)
        print('shot', name)
