// AC-008 ~ AC-011: presets, chapter / sub-chapter editing, AI suggestions.
import { expect, test } from '@playwright/test';
import { installFakeApi } from './support/fakeApi';
import {
  chapterCountInput,
  chapterRows,
  chapterTitleInput,
  confirmDialog,
  openFramework,
  runAiSuggest,
  subslideRows,
  toggleChapter,
} from './support/ui';

test.beforeEach(async ({ page }) => {
  await installFakeApi(page);
  await openFramework(page);
});

test('AC-008 preset switch and reset', async ({ page }) => {
  await expect(page.getByLabel('预设模板')).toHaveValue('blank');
  await expect(chapterRows(page)).toHaveCount(0);

  await page.getByLabel('预设模板').selectOption({ label: '学术研究汇报' });
  await expect(chapterRows(page)).toHaveCount(4);
  await expect(chapterTitleInput(page, 1)).toHaveValue('一、研究背景与意义');
  await expect(page.getByText('预计演示页数：14（按当前框架）')).toBeVisible();

  await page.getByRole('button', { name: '删除第2章' }).click();
  await confirmDialog(page, '确认删除章节？', '确认删除');
  await expect(chapterRows(page)).toHaveCount(3);

  await page.getByRole('button', { name: '重置默认' }).click();
  await expect(page.getByText('将按“学术研究汇报”模板重置章节结构，当前未保存的手动调整会丢失。')).toBeVisible();
  await confirmDialog(page, '确认重置默认？', '确认重置');
  await expect(chapterRows(page)).toHaveCount(4);
  await expect(chapterTitleInput(page, 2)).toHaveValue('二、研究方法');
});

test('AC-008 standard review preset comes from the template', async ({ page }) => {
  await page.getByLabel('预设模板').selectOption({ label: '标准审查汇报' });
  await expect(chapterRows(page)).not.toHaveCount(0);
  await expect(chapterTitleInput(page, 1)).toHaveValue(/^一、/);
});

test('AC-009 add and delete chapters', async ({ page }) => {
  await page.getByLabel('预设模板').selectOption({ label: '学术研究汇报' });
  await page.getByRole('button', { name: '+ 添加章节' }).click();
  await expect(page.getByText('将新增第 5 章，并默认附带 1 个子章节。')).toBeVisible();
  await confirmDialog(page, '确认添加章节？', '确认添加');
  await expect(chapterRows(page)).toHaveCount(5);
  await expect(chapterTitleInput(page, 5)).toHaveValue('第5章');
  await expect(subslideRows(page)).toHaveCount(1);
  await expect(subslideRows(page).first().getByRole('textbox')).toHaveValue('新子章节');

  await page.getByRole('button', { name: '删除第1章' }).click();
  await expect(page.getByText('将删除章节“一、研究背景与意义”及其全部子章节。')).toBeVisible();
  await confirmDialog(page, '确认删除章节？', '确认删除');
  await expect(chapterRows(page)).toHaveCount(4);
  await expect(chapterTitleInput(page, 1)).toHaveValue('二、研究方法');
  await expect(chapterRows(page).first().getByRole('cell').first()).toHaveText('1');

  for (const number of [4, 3, 2]) {
    await page.getByRole('button', { name: `删除第${number}章` }).click();
    await confirmDialog(page, '确认删除章节？', '确认删除');
  }
  await expect(chapterRows(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: '删除第1章' })).toBeDisabled();
});

test('AC-010 sub-chapter numbering, resizing and limits', async ({ page }) => {
  await page.getByLabel('预设模板').selectOption({ label: '学术研究汇报' });
  await toggleChapter(page, 1);
  await expect(subslideRows(page)).toHaveCount(2);
  await expect(subslideRows(page).nth(0).getByRole('cell').first()).toHaveText('1-1');
  await expect(subslideRows(page).nth(1).getByRole('cell').first()).toHaveText('1-2');

  await chapterCountInput(page, 1).fill('3');
  await expect(subslideRows(page)).toHaveCount(3);
  await expect(subslideRows(page).nth(2).getByRole('textbox')).toHaveValue('子章节 3');
  await expect(subslideRows(page).nth(2).getByRole('cell').nth(2)).toHaveText(
    (await subslideRows(page).nth(1).getByRole('cell').nth(2).textContent()) ?? '',
  );

  await page.getByRole('button', { name: '+ 添加子章节' }).click();
  await expect(page.getByText('将在“一、研究背景与意义”下新增第 4 个子章节。')).toBeVisible();
  await confirmDialog(page, '确认添加子章节？', '确认添加');
  await expect(subslideRows(page)).toHaveCount(4);
  await expect(subslideRows(page).nth(3).getByRole('cell').nth(2)).toHaveText('文字');

  await page.getByRole('button', { name: '删除第1-1子章节' }).click();
  await expect(page.getByText('将从“一、研究背景与意义”中删除子章节“研究背景”。')).toBeVisible();
  await confirmDialog(page, '确认删除子章节？', '确认删除');
  await expect(subslideRows(page)).toHaveCount(3);
  await expect(subslideRows(page).nth(0).getByRole('textbox')).toHaveValue('研究意义');

  await chapterCountInput(page, 1).fill('1');
  await expect(subslideRows(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: '删除第1-1子章节' })).toBeDisabled();

  await chapterCountInput(page, 1).fill('25');
  await expect(subslideRows(page)).toHaveCount(20);
  await expect(chapterCountInput(page, 1)).toHaveValue('20');
});

test('AC-010 only one chapter is expanded at a time', async ({ page }) => {
  await page.getByLabel('预设模板').selectOption({ label: '学术研究汇报' });
  await toggleChapter(page, 1);
  await expect(subslideRows(page).first().getByRole('cell').first()).toHaveText('1-1');
  await toggleChapter(page, 2);
  await expect(subslideRows(page)).toHaveCount(2);
  await expect(subslideRows(page).first().getByRole('cell').first()).toHaveText('2-1');
  await toggleChapter(page, 2);
  await expect(subslideRows(page)).toHaveCount(0);
});

test('AC-011 AI suggestion fills an empty blank plan', async ({ page }) => {
  await expect(page.getByText('章节覆盖评估：待 AI 建议调整后生成')).toBeVisible();
  await page.getByRole('button', { name: 'AI 建议调整' }).click();
  await expect(page.getByText('将基于当前 0 个章节重新分析并更新建议内容。')).toBeVisible();
  await confirmDialog(page, '确认执行 AI 建议调整？', '开始分析');
  await expect(chapterRows(page)).toHaveCount(6);
  await expect(page.getByText('章节覆盖评估：高覆盖 2 / 中覆盖 2 / 低覆盖 2')).toBeVisible();
  await expect(page.getByText('第1章《一、背景与目标》：第1章与文档内容匹配（示例理由）。')).toBeVisible();
  await expect(chapterRows(page).first().getByText('高覆盖')).toBeVisible();
});

test('AC-011 AI suggestion keeps existing chapter names and updates layout', async ({ page }) => {
  await page.getByLabel('预设模板').selectOption({ label: '学术研究汇报' });
  await toggleChapter(page, 1);
  await expect(subslideRows(page).nth(1).getByRole('cell').nth(2)).toHaveText('文字');
  await runAiSuggest(page);
  await expect(chapterTitleInput(page, 1)).toHaveValue('一、研究背景与意义');
  await expect(subslideRows(page).nth(0).getByRole('cell').nth(2)).toHaveText('文字 + 表格');
  await expect(subslideRows(page).nth(1).getByRole('cell').nth(2)).toHaveText('文字 + 图片');
  await expect(subslideRows(page).nth(1).getByText('子页面 1-2 示例理由。')).toBeVisible();
});

test('AC-011 shows the missing key message', async ({ page }) => {
  await installFakeApi(page, { planError: { status: 503, code: 'missing_api_key' } });
  await runAiSuggest(page);
  await expect(page.getByText('服务端未配置 GEMINI_API_KEY，无法生成 AI 推荐结果。')).toBeVisible();
  await expect(chapterRows(page)).toHaveCount(0);
});
