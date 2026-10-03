// AC-032: screenshots of every step in light and dark themes for the ITEI design review.
// Output: src/screenshots-out/ (ignored by git). Run: npx playwright test e2e/screenshots.spec.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { installFakeApi } from './support/fakeApi';
import { IMAGES, confirmDialog, generateContent, goNext, openFramework, runAiSuggest, toggleChapter } from './support/ui';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots-out');

for (const scheme of ['light', 'dark'] as const) {
  test(`AC-032 ITEI screenshots (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await installFakeApi(page);
    const shot = async (name: string) => {
      // Let open/close and expand transitions finish so the picture shows the settled state.
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, `${scheme}-${name}.png`), fullPage: true });
    };

    await page.goto('/');
    await shot('1-upload-empty');
    await openFramework(page);
    await page.getByRole('button', { name: '← 上一步' }).click();
    await shot('0-confirm-dialog');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await runAiSuggest(page);
    await toggleChapter(page, 1);
    await shot('2-framework');
    await generateContent(page);
    await shot('2-framework-generated');
    await goNext(page);
    await page.getByLabel('上传图片').first().setInputFiles(IMAGES[0]);
    await confirmDialog(page, '确认上传图片？', '确认上传');
    await shot('3-images');
    await goNext(page);
    await page.getByRole('button', { name: '正文编辑', exact: true }).click();
    await page.getByLabel('正文（建议 ≤ 150 字）').fill('测'.repeat(160));
    await shot('4-audit');
  });
}
