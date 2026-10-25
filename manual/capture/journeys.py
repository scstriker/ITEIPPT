"""Capture journeys. Each journey runs in its own browser context and can be re-run alone:
    python manual/capture/journeys.py            # all
    python manual/capture/journeys.py upload audit
"""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import BrowserContext, Page, expect, sync_playwright

from lib import (
    BASE_URL,
    DPR,
    MANUAL,
    SAMPLE_DOC,
    SAMPLE_DOCX,
    SAMPLE_IMAGES,
    SAMPLE_PRESENTER,
    SAMPLE_SCAN,
    VIEWPORT,
    Recorder,
    ai_suggest,
    card,
    chapter_rows,
    confirm,
    generate,
    go_next,
    open_framework,
    servers,
    set_scenario,
    settle,
    upload,
    upload_and_wait,
)

EXPORT_DIR = MANUAL / 'build' / 'export'


def viewport_box(page: Page) -> dict:
    y = page.evaluate('() => window.scrollY')
    return {'x': 0, 'y': y, 'width': VIEWPORT['width'], 'height': VIEWPORT['height']}


def dialog(page: Page):
    return page.get_by_role('dialog')


# ------------------------------------------------------------------ journeys

def j_upload(page: Page, rec: Recorder) -> None:
    set_scenario()
    page.goto(BASE_URL)
    settle(page)
    rec.shot(
        'ui-overview',
        [page.get_by_role('banner'), page.get_by_role('contentinfo')],
        marks=[
            page.get_by_role('banner'),
            page.get_by_role('navigation', name='流程步骤'),
            page.locator('main > div').first,
            page.locator('main > p').first,
            page.locator('main > div').last,
            page.get_by_role('contentinfo'),
        ],
        pad=0,
    )
    rec.shot(
        'upload-settings',
        [card(page, '基础设置'), page.get_by_role('region', name='处理日志')],
        marks=[page.get_by_label('目标页数'), page.get_by_label('汇报人'), page.get_by_label('所属机构'), page.get_by_role('region', name='处理日志')],
    )
    page.get_by_label('汇报人').fill(SAMPLE_PRESENTER)
    upload_and_wait(page)
    rec.shot(
        'upload-done',
        [card(page, '上传文档')],
        marks=[
            page.locator('label').filter(has_text='点击选择文档'),
            card(page, '上传文档').get_by_text('压力传感器标准编制说明（示例）.docx', exact=True).locator('..'),
            page.locator('dl'),
        ],
    )
    rec.shot('upload-log', [page.get_by_role('region', name='处理日志')])
    upload(page, SAMPLE_DOC)
    expect(page.get_by_text('文件格式不支持，仅允许 .pdf / .docx。').last).to_be_visible()
    rec.shot('upload-error-format', [page.locator('p').filter(has_text='文件格式不支持')])
    upload(page, SAMPLE_SCAN)
    expect(page.get_by_text('未提取到有效文本').last).to_be_visible(timeout=30_000)
    rec.shot('upload-error-empty', [page.locator('p').filter(has_text='未提取到有效文本')])
    upload_and_wait(page)
    page.get_by_role('button', name='下一步 →').click()
    expect(dialog(page)).to_be_visible()
    rec.shot('dlg-next', [dialog(page)], marks=[page.get_by_role('button', name='取消', exact=True), page.get_by_role('button', name='进入下一步', exact=True)])
    confirm(page, '确认进入下一步？', '进入下一步')


def j_framework(page: Page, rec: Recorder) -> None:
    set_scenario()
    open_framework(page, preset=None)
    rec.shot('fw-blank', [card(page, '演讲框架规划')])
    page.get_by_label('预设模板').select_option(label='标准审查汇报')
    planner = card(page, '演讲框架规划')
    rec.shot(
        'fw-preset',
        [planner],
        marks=[
            page.get_by_label('预设模板'),
            page.get_by_text('预计演示页数：').locator('..'),
            page.get_by_text('AI 调整建议', exact=True).locator('..'),
            page.get_by_role('table').first,
            page.get_by_text('当前 6 个章节').locator('..'),
            page.get_by_role('button', name='+ 添加章节').locator('..'),
        ],
    )
    chapter_rows(page).first.get_by_role('button', name='展开子章节').click()
    table = page.get_by_role('table').first
    first = chapter_rows(page).first
    sub_table = page.get_by_role('table').nth(1)
    rec.shot(
        'fw-chapter-expanded',
        [first, sub_table, page.get_by_role('button', name='+ 添加子章节')],
        marks=[
            first.get_by_role('button', name='收起子章节'),
            first.get_by_role('textbox'),
            first.get_by_role('spinbutton'),
            first.get_by_role('cell').nth(3),
            first.get_by_role('button', name='删除第1章'),
            sub_table,
            page.get_by_role('button', name='+ 添加子章节'),
        ],
    )
    floating = page.get_by_role('button', name='AI 建议调整')
    rec.shot('fw-ai-button', [floating], pad=20)
    floating.click()
    expect(dialog(page)).to_be_visible()
    rec.shot('dlg-ai', [dialog(page)])
    confirm(page, '确认执行 AI 建议调整？', '开始分析')
    expect(page.get_by_text('章节覆盖评估：高覆盖 3')).to_be_visible()
    rec.shot('fw-ai-box', [page.get_by_text('AI 调整建议', exact=True).locator('..')])
    rec.shot(
        'fw-coverage',
        [table],
        marks=[chapter_rows(page).nth(0).get_by_role('cell').nth(3), sub_table.get_by_role('row').nth(2).get_by_role('cell').nth(2)],
    )
    rec.shot('fw-total', [page.get_by_text('当前 6 个章节').locator('..'), page.get_by_role('button', name='+ 添加章节').locator('..')])
    page.get_by_role('button', name='删除第6章').click()
    expect(dialog(page)).to_be_visible()
    rec.shot('dlg-delete-chapter', [dialog(page)])
    page.get_by_role('button', name='取消', exact=True).click()
    settle(page)
    title = chapter_rows(page).first.get_by_role('textbox')
    original = title.input_value()
    title.fill('')
    page.get_by_role('button', name='开始生成内容').click()
    expect(page.get_by_text('第 1 章标题不能为空。')).to_be_visible()
    rec.shot('fw-validate', [card(page, 'AI 内容生成')])
    title.fill(original)
    set_scenario(keyMissing=True)
    ai_suggest(page)
    expect(page.get_by_text('服务端未配置 GEMINI_API_KEY，无法生成 AI 推荐结果。')).to_be_visible()
    rec.shot('fw-ai-missing-key', [page.locator('p').filter(has_text='服务端未配置 GEMINI_API_KEY')])
    set_scenario()


def j_generate(context: BrowserContext, rec_factory) -> None:
    # progress (job left hanging on purpose)
    page = context.new_page()
    rec = rec_factory(page)
    set_scenario()
    open_framework(page)
    ai_suggest(page)
    rec.shot('gen-card', [card(page, 'AI 内容生成')])
    set_scenario(content='hangAfterFirstBatch')
    page.get_by_role('button', name='开始生成内容').click()
    confirm(page, '确认开始生成内容？', '开始生成', wait_closed=False)
    expect(page.get_by_text('正在生成内容（批次 1/')).to_be_visible(timeout=30_000)
    # The page behind the modal is aria-hidden, so locate by text and scroll with the DOM API.
    page.get_by_text('生成进度', exact=True).evaluate("(el) => el.scrollIntoView({ block: 'center' })")
    rec.shot(
        'gen-progress',
        [viewport_box(page)],
        marks=[dialog(page), page.get_by_text('生成进度', exact=True).locator('../..')],
        pad=0,
    )
    page.close()

    # success, then stale after an edit
    page = context.new_page()
    rec = rec_factory(page)
    set_scenario()
    open_framework(page)
    ai_suggest(page)
    generate(page)
    rec.shot(
        'gen-done',
        [card(page, 'AI 内容生成'), page.get_by_role('button', name='下一步 →')],
        marks=[page.get_by_text('已生成页数：').locator('..'), page.get_by_role('button', name='下一步 →')],
    )
    chapter_rows(page).first.get_by_role('button', name='展开子章节').click()
    sub = page.get_by_role('table').nth(1).get_by_role('textbox').first
    sub.fill(sub.input_value() + '（修改）')
    rec.shot('gen-stale', [page.get_by_text('框架已改动，之前生成的内容已失效').locator('..')])
    rec.shot('nav-blocked', [page.get_by_text('框架已修改，之前生成的内容已失效').locator('..'), page.get_by_role('button', name='下一步 →')])
    page.close()

    # degraded
    page = context.new_page()
    rec = rec_factory(page)
    set_scenario(content='fail')
    open_framework(page)
    ai_suggest(page)
    generate(page)
    rec.shot('gen-degraded', [card(page, 'AI 内容生成')], marks=[page.get_by_text('已降级生成').locator('..')])
    page.close()

    # job cannot be created
    page = context.new_page()
    rec = rec_factory(page)
    set_scenario()
    open_framework(page)
    ai_suggest(page)
    set_scenario(keyMissing=True)
    page.get_by_role('button', name='开始生成内容').click()
    confirm(page, '确认开始生成内容？', '开始生成')
    expect(page.get_by_text('服务端未配置 GEMINI_API_KEY，无法调用内容生成。')).to_be_visible()
    rec.shot(
        'gen-failed',
        [card(page, 'AI 内容生成')],
        marks=[page.get_by_role('button', name='重新生成内容'), page.get_by_role('button', name='重新生成', exact=True), page.locator('p').filter(has_text='服务端未配置')],
    )
    set_scenario()
    page.close()


def reach_images(page: Page, scenario: dict | None = None) -> None:
    set_scenario(**(scenario or {}))
    open_framework(page)
    ai_suggest(page)
    generate(page)
    go_next(page)


def j_images(page: Page, rec: Recorder) -> None:
    reach_images(page)
    toolbar = page.locator('label[for="bulk-import-input"]').locator('..')
    rec.shot(
        'img-top',
        [toolbar],
        marks=[page.get_by_text('导入方式 1').locator('..'), page.locator('label[for="bulk-import-input"]')],
    )
    first_page = page.locator('article').filter(has=page.get_by_role('button', name='复制图片描述')).first
    rec.shot(
        'img-page',
        [first_page],
        marks=[
            first_page.get_by_role('button').first,
            first_page.get_by_role('textbox').first,
            first_page.get_by_text('预览').first.locator('..'),
            first_page.get_by_role('button', name='复制图片描述').first,
            first_page.locator('label').filter(has_text='上传图片').first,
            first_page.get_by_role('button', name='移除').first,
        ],
    )
    first_page.get_by_role('button', name='复制图片描述').first.click()
    first_page.get_by_label('上传图片').first.set_input_files(str(SAMPLE_IMAGES[1]))
    expect(dialog(page)).to_be_visible()
    rec.shot('dlg-image-upload', [dialog(page)])
    confirm(page, '确认上传图片？', '确认上传')
    rec.shot('img-uploaded', [first_page.locator('div.grid').first, first_page.get_by_role('button', name='移除').first], marks=[first_page.get_by_role('img').first])
    page.get_by_label('批量导入图片').set_input_files([str(p) for p in SAMPLE_IMAGES[2:]])
    expect(dialog(page)).to_be_visible()
    rec.shot('dlg-bulk', [dialog(page)])
    confirm(page, '确认批量导入图片？', '确认导入')
    rec.shot('img-bulk-done', [toolbar, page.get_by_text('已导入').last.locator('../..')])
    rec.shot('img-draw', [page.get_by_role('link', name='打开 ITEI DRAW')], pad=20)

    # audit and export continue in the same task (images imported above)
    j_audit_export(page, rec)


def j_audit_export(page: Page, rec: Recorder) -> None:
    go_next(page)
    expect(page.get_by_text('内容审计预览')).to_be_visible()
    audit = card(page, '内容审计预览')
    rec.shot('audit-metrics', [audit.locator('div.grid').first, page.get_by_text('源文件清单').locator('..')])
    workbench = page.get_by_text('逐页审阅', exact=True).locator('../..')
    rec.shot(
        'audit-workbench',
        [workbench],
        marks=[
            page.get_by_role('group', name='审阅筛选'),
            page.get_by_role('button', name='一、项目背景及必要性'),
            page.get_by_role('button', name='P3 '),
            page.get_by_text('第 3 页 · 正文页').locator('../../..'),
            page.get_by_role('navigation', name='审计视图切换').locator('..'),
        ],
    )
    panel = page.get_by_role('navigation', name='审计视图切换').locator('..')
    rec.shot('audit-tab-source', [panel])
    page.get_by_role('button', name='正文编辑', exact=True).click()
    rec.shot('audit-tab-body', [panel], marks=[page.get_by_label('正文（建议 ≤ 150 字）'), page.get_by_text('字数：').first, panel.get_by_role('table')])
    body = page.get_by_label('正文（建议 ≤ 150 字）')
    original = body.input_value()
    body.fill(original + '标准实施后由起草组负责解释，并在发布后 6 个月内组织宣贯培训，同时收集企业试用反馈，作为下一次修订的依据。' * 2)
    rec.shot('audit-body-over', [body, page.get_by_text('字数：').first])
    page.get_by_role('button', name='P4 ').click()
    page.get_by_role('button', name='AI补充', exact=True).click()
    rec.shot('audit-tab-supplements', [panel])
    page.get_by_role('button', name='正文编辑', exact=True).click()
    rec.shot('audit-tab-body-images', [panel])

    export = card(page, 'PPT 导出')
    rec.shot(
        'export-card',
        [export],
        marks=[export.locator('div.grid').first, export.locator('p').filter(has_text='图片槽位未导入'), export.locator('p').filter(has_text='正文超过 150 字'), page.get_by_role('button', name='生成 PPTX')],
    )
    page.get_by_role('button', name='生成 PPTX').click()
    expect(dialog(page)).to_be_visible()
    rec.shot('dlg-export', [dialog(page)])
    confirm(page, '确认生成 PPTX？', '确认生成')
    rec.shot('export-done', [export], marks=[page.get_by_role('button', name='下载生成文件')])
    page.get_by_role('button', name='下载生成文件').click()
    expect(dialog(page)).to_be_visible()
    rec.shot('dlg-download', [dialog(page)])
    with page.expect_download() as info:
        confirm(page, '确认下载文件？', '确认下载')
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    info.value.save_as(str(EXPORT_DIR / 'ITEIPPT_v2_output.pptx'))

    page.get_by_role('button', name='开始新任务').click()
    expect(dialog(page)).to_be_visible()
    rec.shot('dlg-reset', [dialog(page)])
    page.get_by_role('button', name='取消', exact=True).click()


def j_degraded_audit(page: Page, rec: Recorder) -> None:
    reach_images(page, {'content': 'fail'})
    go_next(page)
    page.get_by_role('button', name='仅问题页', exact=True).click()
    page.get_by_role('button', name='缺失项', exact=True).click()
    panel = page.get_by_role('navigation', name='审计视图切换').locator('..')
    rec.shot('audit-tab-missing', [panel])
    rec.shot('audit-filter-issues', [page.get_by_role('group', name='审阅筛选'), page.locator('aside')])


def j_no_images(page: Page, rec: Recorder) -> None:
    reach_images(page, {'plan': 'noImages'})
    rec.shot('img-none', [card(page, 'Step 3 · 配图导入')])


JOURNEYS = {
    'upload': j_upload,
    'framework': j_framework,
    'images': j_images,
    'degraded': j_degraded_audit,
    'noimages': j_no_images,
}


def run(selected: list[str]) -> None:
    with servers(), sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)

        def new_context() -> BrowserContext:
            context = browser.new_context(
                viewport=VIEWPORT,
                device_scale_factor=DPR,
                locale='zh-CN',
                color_scheme='light',
                accept_downloads=True,
                permissions=['clipboard-read', 'clipboard-write'],
            )
            context.set_default_timeout(30_000)
            return context

        def prepared_page(context: BrowserContext) -> Page:
            page = context.new_page()
            context.new_cdp_session(page).send('Emulation.setFocusEmulationEnabled', {'enabled': True})
            return page

        for name in selected:
            context = new_context()
            try:
                if name == 'generate':
                    j_generate(context, lambda pg: Recorder(pg))
                else:
                    page = prepared_page(context)
                    JOURNEYS[name](page, Recorder(page))
            finally:
                context.close()
        browser.close()


if __name__ == '__main__':
    names = sys.argv[1:] or ['upload', 'framework', 'generate', 'images', 'degraded', 'noimages']
    run(names)
