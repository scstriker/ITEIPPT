// AC-013 ~ AC-016: browser-driven batch generation, failure / retry, what leaves the browser, stale results.
import { expect, test } from '@playwright/test';
import { installFakeApi } from './support/fakeApi';
import {
  chapterTitleInput,
  confirmDialog,
  goNext,
  nextButton,
  openFramework,
  stepButton,
  subslideRows,
  toggleChapter,
  uploadDocument,
} from './support/ui';

async function chooseAcademic(page: import('@playwright/test').Page) {
  await page.getByLabel('预设模板').selectOption({ label: '学术研究汇报' });
}

test('AC-013 validates, confirms, shows progress and finishes', async ({ page }) => {
  const api = await installFakeApi(page, { batchDelayMs: 1_500 });
  await openFramework(page);
  await chooseAcademic(page);

  await chapterTitleInput(page, 1).fill('');
  await page.getByRole('button', { name: '开始生成内容' }).click();
  await expect(page.getByText('第 1 章标题不能为空。')).toBeVisible();
  expect(api.batchRequests).toHaveLength(0);
  await chapterTitleInput(page, 1).fill('一、研究背景与意义');

  await page.getByRole('button', { name: '开始生成内容' }).click();
  await expect(page.getByText('将按当前框架生成约 14 页内容，过程可能持续数十秒。')).toBeVisible();
  await confirmDialog(page, '确认开始生成内容？', '开始生成', { waitClosed: false });

  // The confirm dialog stays open with disabled buttons while the batches run. The page behind a modal
  // dialog is hidden from the accessibility tree, so the page button is located by its text.
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeDisabled();
  await expect(page.getByText('任务执行中...')).toBeVisible();
  await expect(page.getByText('正在生成内容（批次 1/2）')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('正在生成内容（批次 2/2）')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('50%')).toBeVisible();
  await expect(page.getByText('已生成页数：')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('原文覆盖率：')).toBeVisible();
  await expect(page.getByRole('heading', { name: '确认开始生成内容？' })).toBeHidden();
  await expect(nextButton(page)).toBeEnabled();
  // 8 content pages -> 2 batches of 4.
  expect(api.batchRequests.map((body) => body.contexts.length)).toEqual([4, 4]);
});

test('AC-014 a failed request shows the reason and can be retried', async ({ page }) => {
  const api = await installFakeApi(page, {
    batchError: { status: 502, code: 'content_generation_failed', message: '内容生成请求失败。', details: 'boom' },
  });
  await openFramework(page);
  await chooseAcademic(page);
  await page.getByRole('button', { name: '开始生成内容' }).click();
  await confirmDialog(page, '确认开始生成内容？', '开始生成');

  await expect(page.getByText('内容生成失败：内容生成请求失败。（boom）')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '重新生成内容' })).toBeEnabled();
  await expect(nextButton(page)).toBeDisabled();
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await confirmDialog(page, '确认开始生成内容？', '开始生成');
  await expect(page.getByText('已生成页数：')).toBeVisible({ timeout: 20_000 });
  expect(api.batchRequests).toHaveLength(3);
});

test('AC-014 degraded results are flagged', async ({ page }) => {
  await installFakeApi(page, { degraded: true });
  await openFramework(page);
  await chooseAcademic(page);
  await page.getByRole('button', { name: '开始生成内容' }).click();
  await confirmDialog(page, '确认开始生成内容？', '开始生成');
  await expect(page.getByText('已降级生成，可继续编辑（原因：batch_generation_failed）。')).toBeVisible({ timeout: 20_000 });
});

test('AC-015 batch requests carry one batch of pages and excerpts, not the document or the cover', async ({ page }) => {
  const api = await installFakeApi(page);
  await page.goto('/');
  await page.getByLabel('汇报人').fill('张三（示例）');
  await uploadDocument(page);
  await goNext(page);
  await chooseAcademic(page);
  await page.getByRole('button', { name: '开始生成内容' }).click();
  await confirmDialog(page, '确认开始生成内容？', '开始生成');
  await expect(page.getByText('已生成页数：')).toBeVisible({ timeout: 20_000 });

  for (const body of api.batchRequests) {
    expect(Object.keys(body).sort()).toEqual(['contexts', 'excerpts', 'presetId']);
    expect(body.contexts.length).toBeLessThanOrEqual(4);
    expect(body.excerpts.full.text.length).toBeLessThanOrEqual(36_005);
    expect(body.excerpts.compact.text.length).toBeLessThanOrEqual(8_005);
    expect(JSON.stringify(body)).not.toContain('张三（示例）');
  }
});

test('AC-016 editing the framework invalidates the result until reverted', async ({ page }) => {
  await installFakeApi(page);
  await openFramework(page);
  await chooseAcademic(page);
  await page.getByRole('button', { name: '开始生成内容' }).click();
  await confirmDialog(page, '确认开始生成内容？', '开始生成');
  await expect(page.getByText('已生成页数：')).toBeVisible({ timeout: 20_000 });
  await expect(stepButton(page, '配图导入')).toBeEnabled();

  await toggleChapter(page, 1);
  const subtitle = subslideRows(page).first().getByRole('textbox');
  await subtitle.fill('研究背景（改）');
  await expect(page.getByText('框架已改动，之前生成的内容已失效。请重新点击“开始生成内容”。')).toBeVisible();
  await expect(stepButton(page, '配图导入')).toBeDisabled();
  await expect(stepButton(page, '审计预览')).toBeDisabled();

  await subtitle.fill('研究背景');
  await expect(page.getByText('框架已改动，之前生成的内容已失效。请重新点击“开始生成内容”。')).toBeHidden();
  await expect(stepButton(page, '配图导入')).toBeEnabled();
});
