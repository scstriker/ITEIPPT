// AC-021 ~ AC-022: audit metrics, filters, tabs and inline editing.
import { expect, type Page, test } from '@playwright/test';
import { installFakeApi } from './support/fakeApi';
import { reachStep } from './support/ui';

function metric(page: Page, label: string) {
  return page.getByText(label, { exact: true }).first().locator('..');
}

function slideCard(page: Page, pageNumber: number) {
  return page.getByRole('button', { name: new RegExp(`^P${pageNumber} `) });
}

test.beforeEach(async ({ page }) => {
  await installFakeApi(page);
  await reachStep(page, '审计预览');
});

test('AC-021 metrics, source files, filters and tabs', async ({ page }) => {
  await expect(page.getByText('内容审计预览')).toBeVisible();
  await expect(metric(page, '总页数')).toContainText('20');
  await expect(metric(page, '原文覆盖率')).toContainText('50%');
  await expect(metric(page, 'AI 补充项')).toContainText('6');
  await expect(metric(page, '缺失项')).toContainText('6');
  await expect(page.getByRole('cell', { name: '技术要求（示例）.docx' }).first()).toBeVisible();

  // Default filter: content pages only.
  await expect(page.getByRole('button', { name: /封面与开场/ })).toHaveCount(0);
  await expect(slideCard(page, 3)).toBeVisible();

  await page.getByRole('button', { name: '全部页面', exact: true }).click();
  await expect(page.getByRole('button', { name: /封面与开场/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /结束与收尾/ })).toBeVisible();

  await page.getByRole('button', { name: '仅问题页', exact: true }).click();
  await expect(page.getByRole('button', { name: /封面与开场/ })).toHaveCount(0);
  await expect(slideCard(page, 4)).toBeVisible();
  await expect(slideCard(page, 3)).toHaveCount(0);

  await page.getByRole('button', { name: 'AI补充', exact: true }).click();
  await expect(page.getByText('[AI 概括] 第 4 页补充（示例）')).toBeVisible();
  await page.getByRole('button', { name: '缺失项', exact: true }).click();
  await expect(page.getByRole('cell', { name: '本页正文由低证据或自动归纳补全生成，建议人工复核关键结论与数据。' })).toBeVisible();
  await page.getByRole('button', { name: '溯源', exact: true }).click();
  await expect(page.getByText('示例原文第 4 段')).toBeVisible();
  await expect(page.getByText('AI 补充构建').first()).toBeVisible();
});

test('AC-021 grouped sidebar opens one chapter at a time', async ({ page }) => {
  await expect(slideCard(page, 3)).toBeVisible();
  const first = page.getByRole('button', { name: /一、背景与目标/ });
  const second = page.getByRole('button', { name: /二、关键问题分析/ });
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await second.click();
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await slideCard(page, 7).click();
  await page.getByRole('button', { name: '正文编辑', exact: true }).click();
  await expect(page.getByText('图片 1：未导入 · 第 7 页图 1')).toBeVisible();
});

test('AC-022 editing body text updates the word count and export preflight', async ({ page }) => {
  await page.getByRole('button', { name: '正文编辑', exact: true }).click();
  const body = page.getByLabel('正文（建议 ≤ 150 字）');
  await body.fill('测'.repeat(160));
  await expect(page.getByText('字数：160/150')).toBeVisible();
  await expect(page.getByText('页面 3 的正文超过 150 字，可能导致排版拥挤。')).toBeVisible();

  await body.fill('测'.repeat(20));
  await expect(page.getByText('字数：20/150')).toBeVisible();
  await expect(page.getByText('页面 3 的正文超过 150 字，可能导致排版拥挤。')).toBeHidden();
});
