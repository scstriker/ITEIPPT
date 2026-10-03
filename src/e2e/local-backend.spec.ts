// AC-029 / NFR-002: the whole flow against the real local backend (memory jobs, in-process worker)
// and the scripted Gemini stub. Run with `npm run e2e:local`.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { IMAGES, confirmDialog, generateContent, goNext, openFramework, runAiSuggest } from './support/ui';

test('AC-029 upload, plan, generate, import, audit and export locally', async ({ page }) => {
  await openFramework(page);
  await runAiSuggest(page);
  await expect(page.getByText('第1章《一、背景与目标》：第1章与文档内容匹配（示例理由）。')).toBeVisible();

  await generateContent(page);
  await expect(page.getByText('已生成页数：')).toBeVisible();
  await goNext(page);

  await page.getByLabel('上传图片').first().setInputFiles(IMAGES[0]);
  await confirmDialog(page, '确认上传图片？', '确认上传');
  await goNext(page);
  await expect(page.getByText('内容审计预览')).toBeVisible();

  await page.getByRole('button', { name: '生成 PPTX' }).click();
  await confirmDialog(page, '确认生成 PPTX？', '确认生成');
  await page.getByRole('button', { name: '下载生成文件' }).click();
  const downloadPromise = page.waitForEvent('download');
  await confirmDialog(page, '确认下载文件？', '确认下载');
  const download = await downloadPromise;

  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  // 6 chapters x 2 sub-chapters + 6 section pages + cover + ending.
  expect(slides).toHaveLength(20);
  const page3 = await zip.file('ppt/slides/slide3.xml')!.async('string');
  expect(page3).toContain('测量范围覆盖 0～10 kPa');
});
