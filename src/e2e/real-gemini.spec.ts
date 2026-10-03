// Opt-in: real Gemini through the local backend (npm run e2e:real). Saves the PPTX to %TEMP%.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { IMAGES, confirmDialog, goNext, openFramework } from './support/ui';

test('real Gemini: 4 steps and export', async ({ page }) => {
  await openFramework(page);
  await page.getByLabel('预设模板').selectOption({ label: '学术研究汇报' });
  await page.getByRole('button', { name: 'AI 建议调整' }).click();
  await confirmDialog(page, '确认执行 AI 建议调整？', '开始分析', { waitClosed: false });
  await expect(page.getByRole('heading', { name: '确认执行 AI 建议调整？' })).toBeHidden({ timeout: 180_000 });
  console.log('AI suggestions:', await page.getByText(/^第\d章《/).allTextContents());

  await page.getByRole('button', { name: '开始生成内容' }).click();
  await confirmDialog(page, '确认开始生成内容？', '开始生成', { waitClosed: false });
  await expect(page.getByText('已生成页数：')).toBeVisible({ timeout: 10 * 60_000 });
  console.log(await page.getByText('已生成页数：').locator('..').textContent());
  const degraded = page.getByText(/已降级生成/);
  console.log('degraded:', await degraded.count());

  await goNext(page);
  const uploads = page.getByLabel('上传图片');
  if (await uploads.count()) {
    await uploads.first().setInputFiles(IMAGES[0]);
    await confirmDialog(page, '确认上传图片？', '确认上传');
  }
  await goNext(page);
  await page.getByRole('button', { name: '生成 PPTX' }).click();
  await confirmDialog(page, '确认生成 PPTX？', '确认生成');
  await page.getByRole('button', { name: '下载生成文件' }).click();
  const downloadPromise = page.waitForEvent('download');
  await confirmDialog(page, '确认下载文件？', '确认下载');
  const download = await downloadPromise;
  const bytes = await readFile(await download.path());
  const out = path.join(process.env.TEMP ?? '.', 'iteislides-real-output.pptx');
  await writeFile(out, bytes);
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  console.log('slides:', slides.length, 'saved to', out);
  expect(slides.length).toBe(14);
});
