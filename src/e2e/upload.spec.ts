// AC-001 ~ AC-004: upload, validation, summary, cover back-fill.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { installFakeApi } from './support/fakeApi';
import {
  BLANK_PDF,
  DOC_TITLE,
  DOCX,
  PDF,
  TXT,
  confirmDialog,
  documentInput,
  generateContent,
  goNext,
  nextButton,
  runAiSuggest,
  uploadDocument,
} from './support/ui';

test.beforeEach(async ({ page }) => {
  await installFakeApi(page);
  await page.goto('/');
});

test('AC-001 parses a docx and enables next', async ({ page }) => {
  await expect(nextButton(page)).toBeDisabled();
  await uploadDocument(page, DOCX);
  await expect(page.getByText('技术要求（示例）.docx').first()).toBeVisible();
  await expect(page.getByText(/^\d+\.\d KB$/)).toBeVisible();
  await expect(nextButton(page)).toBeEnabled();
});

test('AC-001 parses a pdf', async ({ page }) => {
  await uploadDocument(page, PDF);
  await expect(page.getByText(DOC_TITLE).first()).toBeVisible();
  await expect(page.getByText('PDF', { exact: true })).toBeVisible();
});

test('AC-002 rejects unsupported, oversized and empty files', async ({ page }) => {
  const formatError = '文件格式不支持，仅允许 .pdf / .docx。';

  await documentInput(page).setInputFiles({ name: '旧格式（示例）.doc', mimeType: 'application/msword', buffer: Buffer.from('doc') });
  await expect(page.getByRole('paragraph').filter({ hasText: formatError })).toBeVisible();

  await documentInput(page).setInputFiles(TXT);
  await expect(page.getByRole('paragraph').filter({ hasText: formatError })).toBeVisible();

  await documentInput(page).setInputFiles({
    name: '超大文件（示例）.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole('paragraph').filter({ hasText: '文件过大，请上传不超过 20MB 的文档。' })).toBeVisible();

  await documentInput(page).setInputFiles(BLANK_PDF);
  await expect(
    page.getByRole('paragraph').filter({ hasText: '未提取到有效文本，请确认文件不是扫描图片或加密文档。' }),
  ).toBeVisible();

  await expect(nextButton(page)).toBeDisabled();
});

test('AC-004 shows the summary and the processing log', async ({ page }) => {
  await expect(page.getByText('待上传文档', { exact: true })).toBeVisible();
  await uploadDocument(page, DOCX);
  await expect(page.getByText(DOC_TITLE).first()).toBeVisible();
  await expect(page.getByText('DOCX', { exact: true })).toBeVisible();
  await expect(page.getByText(/已选择文件：技术要求（示例）\.docx/)).toBeVisible();
  await expect(page.getByText('开始提取并分析文档内容…')).toBeVisible();
});

test('AC-003 back-fills cover and ending info into the generated deck', async ({ page }) => {
  await expect(page.getByLabel('所属机构')).toHaveValue('机械工业仪器仪表综合技术经济研究所');
  await expect(page.getByLabel('目标页数')).toHaveValue('20');
  await page.getByLabel('汇报人').fill('张三（示例）');
  await uploadDocument(page, DOCX);
  await goNext(page);
  await runAiSuggest(page);
  await generateContent(page);
  await goNext(page);
  await goNext(page);

  await page.getByRole('button', { name: '全部页面', exact: true }).click();
  await page.getByRole('button', { name: /封面与开场/ }).click();
  await page.getByRole('button', { name: /^P1 / }).click();
  // The cover preview shows the document title (cover standard name) under the cover heading.
  await expect(page.locator('article p').filter({ hasText: DOC_TITLE }).last()).toBeVisible();
  await page.getByRole('button', { name: /结束与收尾/ }).click();
  await page.getByRole('button', { name: /^P20 / }).click();
  await expect(page.getByText('机械工业仪器仪表综合技术经济研究所').last()).toBeVisible();
  await expect(page.getByRole('cell', { name: '技术要求（示例）.docx' }).first()).toBeVisible();

  await page.getByRole('button', { name: '生成 PPTX' }).click();
  await confirmDialog(page, '确认生成 PPTX？', '确认生成');
  await page.getByRole('button', { name: '下载生成文件' }).click();
  const downloadPromise = page.waitForEvent('download');
  await confirmDialog(page, '确认下载文件？', '确认下载');
  const zip = await JSZip.loadAsync(await readFile(await (await downloadPromise).path()));
  expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('张三（示例）');
});
