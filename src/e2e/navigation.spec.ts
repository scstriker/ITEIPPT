// AC-005 ~ AC-007: step gating, confirm dialogs, start a new task.
import { expect, test } from '@playwright/test';
import { installFakeApi } from './support/fakeApi';
import {
  IMAGES,
  cancelDialog,
  chapterTitleInput,
  confirmDialog,
  generateContent,
  goNext,
  goPrev,
  nextButton,
  openFramework,
  reachStep,
  runAiSuggest,
  stepButton,
  uploadDocument,
} from './support/ui';

test.beforeEach(async ({ page }) => {
  await installFakeApi(page);
});

test('AC-005 blocks steps until their inputs exist', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('请先上传并解析文档，再进入下一步。')).toBeVisible();
  for (const label of ['规划框架', '配图导入', '审计预览']) {
    await expect(stepButton(page, label)).toBeDisabled();
  }

  await uploadDocument(page);
  await expect(stepButton(page, '规划框架')).toBeEnabled();
  await goNext(page);
  await expect(page.getByText('请先在当前框架下生成内容，再进入下一步。')).toBeVisible();
  await expect(nextButton(page)).toBeDisabled();

  await runAiSuggest(page);
  await generateContent(page);
  await expect(nextButton(page)).toBeEnabled();
  await expect(stepButton(page, '审计预览')).toBeEnabled();

  await chapterTitleInput(page, 1).fill('一、背景与目标（改）');
  await expect(page.getByText('框架已修改，之前生成的内容已失效。请重新生成后再进入下一步。')).toBeVisible();
  await expect(stepButton(page, '配图导入')).toBeDisabled();
  await expect(stepButton(page, '审计预览')).toBeDisabled();
  await expect(nextButton(page)).toBeDisabled();
});

test('AC-006 every navigation asks for confirmation', async ({ page }) => {
  await page.goto('/');
  await uploadDocument(page);

  await nextButton(page).click();
  await expect(page.getByText('即将从“上传文档”进入“规划框架”。')).toBeVisible();
  await cancelDialog(page, '确认进入下一步？');
  await expect(page.getByText('文档摘要')).toBeVisible();

  await goNext(page);
  await expect(page.getByLabel('预设模板')).toBeVisible();

  await page.getByRole('button', { name: '← 上一步' }).click();
  await expect(page.getByText('即将从“规划框架”返回到“上传文档”。')).toBeVisible();
  await cancelDialog(page, '确认返回上一步？');
  await expect(page.getByLabel('预设模板')).toBeVisible();
  await goPrev(page);
  await expect(page.getByText('文档摘要')).toBeVisible();

  await stepButton(page, '规划框架').click();
  await expect(page.getByText('即将从“上传文档”跳转到“规划框架”。')).toBeVisible();
  await confirmDialog(page, '确认切换步骤？', '确认切换');
  await expect(page.getByLabel('预设模板')).toBeVisible();
});

test('AC-007 start a new task clears everything', async ({ page }) => {
  await reachStep(page, '配图导入');
  await page.getByLabel('上传图片').first().setInputFiles(IMAGES[0]);
  await confirmDialog(page, '确认上传图片？', '确认上传');
  await goNext(page);
  await expect(page.getByText('内容审计预览')).toBeVisible();

  await page.getByRole('button', { name: /开始新任务/ }).click();
  await expect(page.getByText('当前位于“审计预览”。确认后将清空文档、框架、导入图片、审计修改与导出结果，并自动返回“上传文档”。')).toBeVisible();
  await confirmDialog(page, '确认开始新任务？', '确认清空并开始');

  await expect(page.getByText('待上传文档', { exact: true })).toBeVisible();
  for (const label of ['规划框架', '配图导入', '审计预览']) {
    await expect(stepButton(page, label)).toBeDisabled();
  }
});

test('AC-005 next is enabled again after regenerating', async ({ page }) => {
  await openFramework(page);
  await runAiSuggest(page);
  await generateContent(page);
  await chapterTitleInput(page, 2).fill('二、关键问题分析（改）');
  await expect(nextButton(page)).toBeDisabled();
  await page.getByRole('button', { name: '开始生成内容' }).click();
  await confirmDialog(page, '确认开始生成内容？', '开始生成');
  await expect(nextButton(page)).toBeEnabled({ timeout: 20_000 });
});
