// AC-013 ~ AC-016: async generation job, failure / retry, resume record, stale results.
import { expect, test } from '@playwright/test';
import { DEFAULT_JOB_STEPS, installFakeApi } from './support/fakeApi';
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

const STORAGE_KEY = 'itei_step2_active_generation_job';

async function chooseAcademic(page: import('@playwright/test').Page) {
  await page.getByLabel('预设模板').selectOption({ label: '学术研究汇报' });
}

test('AC-013 validates, confirms, shows progress and finishes', async ({ page }) => {
  const api = await installFakeApi(page);
  await openFramework(page);
  await chooseAcademic(page);

  await chapterTitleInput(page, 1).fill('');
  await page.getByRole('button', { name: '开始生成内容' }).click();
  await expect(page.getByText('第 1 章标题不能为空。')).toBeVisible();
  expect(api.jobRequests).toHaveLength(0);
  await chapterTitleInput(page, 1).fill('一、研究背景与意义');

  await page.getByRole('button', { name: '开始生成内容' }).click();
  await expect(page.getByText('将按当前框架生成约 14 页内容，过程可能持续数十秒。')).toBeVisible();
  await confirmDialog(page, '确认开始生成内容？', '开始生成', { waitClosed: false });

  // The confirm dialog stays open with disabled buttons while the job runs. The page behind a modal
  // dialog is hidden from the accessibility tree, so the page button is located by its text.
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeDisabled();
  await expect(page.getByText('任务执行中...')).toBeVisible();
  await expect(page.getByText('正在生成内容（批次 1/2）')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('40%')).toBeVisible();
  await expect(page.getByText('已生成页数：')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('原文覆盖率：')).toBeVisible();
  await expect(page.getByRole('heading', { name: '确认开始生成内容？' })).toBeHidden();
  await expect(nextButton(page)).toBeEnabled();
  expect(api.jobRequests).toHaveLength(1);
  expect(api.jobRequests[0].frameworkPlan.chapters).toHaveLength(4);
});

test('AC-014 failed job shows the reason and can be retried', async ({ page }) => {
  const api = await installFakeApi(page, {
    jobSteps: [
      DEFAULT_JOB_STEPS[0],
      {
        status: 'failed',
        percent: 10,
        stage: '执行失败',
        error: { code: 'generation_job_failed', message: '内容生成任务执行失败。', details: 'boom' },
      },
    ],
  });
  await openFramework(page);
  await chooseAcademic(page);
  await page.getByRole('button', { name: '开始生成内容' }).click();
  await confirmDialog(page, '确认开始生成内容？', '开始生成');

  await expect(page.getByText('内容生成失败：内容生成任务执行失败。（boom）')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '重新生成内容' })).toBeEnabled();
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await confirmDialog(page, '确认开始生成内容？', '开始生成');
  await expect.poll(() => api.jobRequests.length).toBe(2);
  await expect(nextButton(page)).toBeDisabled();
});

test('AC-014 degraded results are flagged', async ({ page }) => {
  await installFakeApi(page, { generationMeta: { mode: 'degraded', reason: 'batch_generation_failed' } });
  await openFramework(page);
  await chooseAcademic(page);
  await page.getByRole('button', { name: '开始生成内容' }).click();
  await confirmDialog(page, '确认开始生成内容？', '开始生成');
  await expect(page.getByText('已降级生成，可继续编辑（原因：batch_generation_failed）。')).toBeVisible({ timeout: 20_000 });
});

test('AC-015 resumes a stored job when the framework digest matches', async ({ page }) => {
  const seededPlan = {
    presetId: 'blank',
    coverInfo: {},
    endingInfo: {},
    chapters: [{ chapterIndex: 1, chapterTitle: '一、示例', slides: [{ subtitle: '示例页', visualMode: 'table' }] }],
  };
  const api = await installFakeApi(page, { seedJobs: { 'resume-1': { frameworkPlan: seededPlan, textContent: 'x' } } });
  await page.goto('/');
  await uploadDocument(page);
  await page.evaluate(
    ([key, value]) => sessionStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify({ jobId: 'resume-1', planDigest: '{"presetId":"blank","chapters":[]}', savedAt: 'x' })],
  );
  await goNext(page);
  await expect(page.getByText('已生成页数：')).toBeVisible({ timeout: 20_000 });
  expect(api.statusRequests[0]).toBe('resume-1');
  expect(api.jobRequests).toHaveLength(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
});

test('AC-015 drops a stored job whose framework differs', async ({ page }) => {
  const api = await installFakeApi(page);
  await page.goto('/');
  await uploadDocument(page);
  await page.evaluate(
    ([key, value]) => sessionStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify({ jobId: 'old-1', planDigest: '{"presetId":"academic_research","chapters":[]}', savedAt: 'x' })],
  );
  await goNext(page);
  await expect(page.getByLabel('预设模板')).toBeVisible();
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
  expect(api.statusRequests).toHaveLength(0);
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
