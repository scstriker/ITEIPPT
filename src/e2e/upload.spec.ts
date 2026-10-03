// AC-001 ~ AC-004: upload, validation, summary, cover back-fill.
import { expect, test } from '@playwright/test';
import { installFakeApi } from './support/fakeApi';
import {
  BLANK_PDF,
  DOC_TITLE,
  DOCX,
  PDF,
  TXT,
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

test('AC-003 back-fills cover and ending info into the generation request', async ({ page }) => {
  const api = await installFakeApi(page);
  await page.goto('/');
  await expect(page.getByLabel('所属机构')).toHaveValue('机械工业仪器仪表综合技术经济研究所');
  await expect(page.getByLabel('目标页数')).toHaveValue('20');
  await page.getByLabel('汇报人').fill('张三（示例）');
  await uploadDocument(page, DOCX);
  await goNext(page);
  await runAiSuggest(page);
  await generateContent(page);
  const plan = api.jobRequests[0].frameworkPlan;
  expect(plan.coverInfo.standardName).toBe(DOC_TITLE);
  expect(plan.coverInfo.presenter).toBe('张三（示例）');
  expect(plan.endingInfo.organization).toBe('机械工业仪器仪表综合技术经济研究所');
  expect(api.jobRequests[0].sourceFilename).toBe('技术要求（示例）.docx');
});
