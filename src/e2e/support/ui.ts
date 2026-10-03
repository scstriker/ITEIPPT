// Page helpers. Locators use visible text, ARIA roles and labels only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const DOCX = path.join(FIXTURES, '技术要求（示例）.docx');
export const PDF = path.join(FIXTURES, '技术要求（示例）.pdf');
export const BLANK_PDF = path.join(FIXTURES, '空白扫描件（示例）.pdf');
export const TXT = path.join(FIXTURES, '说明（示例）.txt');
export const IMAGES = [1, 2, 3, 4].map((n) => path.join(FIXTURES, `配图${n}（示例）.png`));
export const DOC_TITLE = '医用呼吸机压力传感器技术要求（示例）';

// The dialog stays open (buttons disabled) until the confirmed action finishes.
export async function confirmDialog(
  page: Page,
  title: string,
  confirmText: string,
  { waitClosed = true }: { waitClosed?: boolean } = {},
): Promise<void> {
  const heading = page.getByRole('heading', { name: title, exact: true });
  await expect(heading).toBeVisible();
  await page.getByRole('button', { name: confirmText, exact: true }).click();
  if (waitClosed) {
    await expect(heading).toBeHidden({ timeout: 30_000 });
  }
}

export async function cancelDialog(page: Page, title: string, cancelText = '取消'): Promise<void> {
  const heading = page.getByRole('heading', { name: title, exact: true });
  await expect(heading).toBeVisible();
  await page.getByRole('button', { name: cancelText, exact: true }).click();
  await expect(heading).toBeHidden();
}

export function documentInput(page: Page): Locator {
  return page.getByLabel(/点击选择文档|解析中/);
}

export async function uploadDocument(page: Page, file = DOCX): Promise<void> {
  await documentInput(page).setInputFiles(file);
  await expect(page.getByText('文档已解析并可进入下一步。')).toBeVisible();
}

export function nextButton(page: Page): Locator {
  return page.getByRole('button', { name: '下一步 →' });
}

export function prevButton(page: Page): Locator {
  return page.getByRole('button', { name: '← 上一步' });
}

export async function goNext(page: Page): Promise<void> {
  await nextButton(page).click();
  await confirmDialog(page, '确认进入下一步？', '进入下一步');
}

export async function goPrev(page: Page): Promise<void> {
  await prevButton(page).click();
  await confirmDialog(page, '确认返回上一步？', '返回上一步');
}

export function stepButton(page: Page, label: string): Locator {
  return page.getByRole('navigation').getByRole('button', { name: new RegExp(label) });
}

export async function openFramework(page: Page, file = DOCX): Promise<void> {
  await page.goto('/');
  await uploadDocument(page, file);
  await goNext(page);
  await expect(page.getByLabel('预设模板')).toBeVisible();
}

export function chapterRows(page: Page): Locator {
  return page.getByRole('row').filter({ has: page.getByRole('spinbutton') });
}

export function chapterTitleInput(page: Page, chapterNumber: number): Locator {
  return chapterRows(page).nth(chapterNumber - 1).getByRole('textbox');
}

export function chapterCountInput(page: Page, chapterNumber: number): Locator {
  return chapterRows(page).nth(chapterNumber - 1).getByRole('spinbutton');
}

export async function toggleChapter(page: Page, chapterNumber: number): Promise<void> {
  await chapterRows(page)
    .nth(chapterNumber - 1)
    .getByRole('button', { name: /展开子章节|收起子章节/ })
    .click();
}

export function subslideRows(page: Page): Locator {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: /^\d+-\d+$/ }) })
    .filter({ hasNot: page.getByRole('table') });
}

export async function runAiSuggest(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'AI 建议调整' }).click();
  await confirmDialog(page, '确认执行 AI 建议调整？', '开始分析');
  await expect(page.getByRole('button', { name: 'AI 建议调整' })).toBeEnabled();
}

export async function startGenerate(page: Page): Promise<void> {
  await page.getByRole('button', { name: '开始生成内容' }).click();
  await confirmDialog(page, '确认开始生成内容？', '开始生成');
}

export async function generateContent(page: Page): Promise<void> {
  await startGenerate(page);
  await expect(page.getByText('已生成页数：')).toBeVisible({ timeout: 20_000 });
}

/** Upload → AI suggest (6 blank chapters) → generate → land on the requested step. */
export async function reachStep(page: Page, step: '配图导入' | '审计预览', file = DOCX): Promise<void> {
  await openFramework(page, file);
  await runAiSuggest(page);
  await generateContent(page);
  await goNext(page);
  if (step === '审计预览') {
    await goNext(page);
  }
}

/** Upload → academic preset (4 chapters, 8 slides) → generate. */
export async function generateAcademic(page: Page): Promise<void> {
  await openFramework(page);
  await page.getByLabel('预设模板').selectOption({ label: '学术研究汇报' });
  await runAiSuggest(page);
  await generateContent(page);
}

/** The textbox whose current value equals `value` (inline table cells have no labels). */
export async function textboxWithValue(page: Page, value: string): Promise<Locator> {
  const boxes = page.getByRole('textbox');
  const count = await boxes.count();
  for (let index = 0; index < count; index += 1) {
    if ((await boxes.nth(index).inputValue()) === value) {
      return boxes.nth(index);
    }
  }
  throw new Error(`No textbox with value ${value}`);
}
