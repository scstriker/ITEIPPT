// AC-022 (export of edits), AC-023, AC-025: preflight, confirm with risk summary, download.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { installFakeApi } from './support/fakeApi';
import { IMAGES, confirmDialog, goNext, reachStep, textboxWithValue } from './support/ui';

test('AC-023 / AC-025 / AC-022 preflight, confirm, download and edited content in the file', async ({ page }) => {
  await installFakeApi(page, {
    visualModeFor: (chapter, slide) => (chapter === 1 && slide === 2 ? 'images' : 'table'),
  });
  await reachStep(page, '配图导入');
  await page.getByLabel('上传图片').first().setInputFiles(IMAGES[0]);
  await confirmDialog(page, '确认上传图片？', '确认上传');
  await goNext(page);

  await page.getByRole('button', { name: '正文编辑', exact: true }).click();
  await page.getByLabel('正文（建议 ≤ 150 字）').fill(`${'超'.repeat(150)}长正文`);
  await (await textboxWithValue(page, '0～10 kPa')).fill('0～20 kPa（改）');

  await expect(page.getByText('图片槽位：')).toBeVisible();
  await expect(page.getByText('1/2')).toBeVisible();
  await expect(page.getByText('仍有 1 个图片槽位未导入，导出后将使用占位文本。')).toBeVisible();

  await page.getByRole('button', { name: '生成 PPTX' }).click();
  await expect(page.getByText('将基于当前 20 页内容生成 PPTX。风险提示：缺少 1 个图片槽位；页面 3 正文超 150 字')).toBeVisible();
  await confirmDialog(page, '确认生成 PPTX？', '确认生成');

  await page.getByRole('button', { name: '下载生成文件' }).click();
  await expect(page.getByText('将下载文件“ITEIPPT_v2_output.pptx”到本地设备。')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await confirmDialog(page, '确认下载文件？', '确认下载');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ITEIPPT_v2_output.pptx');

  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  expect(slides).toHaveLength(20);
  const page3 = await zip.file('ppt/slides/slide3.xml')!.async('string');
  expect(page3).toContain('0～20 kPa（改）');
  expect(page3).toContain('长正文');
  // Page 4 has one of two images imported: the image is placed, no prompt placeholder is written.
  const page4 = await zip.file('ppt/slides/slide4.xml')!.async('string');
  expect(page4).not.toContain('复制以下内容并在 ITEI Draw 生成PPT配图');
  const page4Rels = await zip.file('ppt/slides/_rels/slide4.xml.rels')!.async('string');
  expect(page4Rels).toMatch(/media\/image-4-\d+\.png/);
});

test('AC-023 no risk when everything is in place', async ({ page }) => {
  await installFakeApi(page, { noImages: true });
  await reachStep(page, '审计预览');
  await expect(page.getByText('超字数页面：')).toBeVisible();
  await page.getByRole('button', { name: '生成 PPTX' }).click();
  await expect(page.getByText('将基于当前 20 页内容生成 PPTX。风险提示：当前未发现高风险项。')).toBeVisible();
  await confirmDialog(page, '确认生成 PPTX？', '返回检查', { waitClosed: true });
  await expect(page.getByRole('button', { name: '下载生成文件' })).toHaveCount(0);
});
