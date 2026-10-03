// AC-018 ~ AC-020: per-slot import, bulk import, copy prompt, ITEI DRAW link, no-image case.
import { expect, test } from '@playwright/test';
import { installFakeApi } from './support/fakeApi';
import { IMAGES, TXT, confirmDialog, reachStep } from './support/ui';

test('AC-018 upload, replace and remove one slot', async ({ page }) => {
  await installFakeApi(page);
  await reachStep(page, '配图导入');
  await expect(page.getByText('当前进度：已导入 0/12，待导入 12。')).toBeVisible();
  await expect(page.getByRole('button', { name: /第 4 页/ })).toHaveAttribute('aria-expanded', 'true');

  await page.getByLabel('上传图片').first().setInputFiles(TXT);
  await expect(page.getByText('文件“说明（示例）.txt”不是图片格式，请重新选择。')).toBeVisible();

  await page.getByLabel('上传图片').first().setInputFiles(IMAGES[0]);
  await expect(page.getByText('将上传“配图1（示例）.png”到第 4 页第 1 个图片槽位。')).toBeVisible();
  await confirmDialog(page, '确认上传图片？', '确认上传');
  await expect(page.getByRole('img', { name: '第4页图片1' })).toBeVisible();
  await expect(page.getByText('当前进度：已导入 1/12，待导入 11。')).toBeVisible();

  await page.getByLabel('替换图片').first().setInputFiles(IMAGES[1]);
  await expect(page.getByText('将用“配图2（示例）.png”替换第 4 页第 1 个图片槽位的现有图片。')).toBeVisible();
  await confirmDialog(page, '确认替换图片？', '确认替换');
  await expect(page.getByText('已更新图片：配图2（示例）.png')).toBeVisible();

  await page.getByRole('button', { name: '移除', exact: true }).first().click();
  await confirmDialog(page, '确认移除图片？', '确认移除');
  await expect(page.getByText('已移除图片，可重新上传。')).toBeVisible();
  await expect(page.getByText('当前进度：已导入 0/12，待导入 12。')).toBeVisible();
  await expect(page.getByRole('img', { name: '第4页图片1' })).toHaveCount(0);
});

test('AC-019 bulk import fills empty slots in page order', async ({ page }) => {
  await installFakeApi(page, {
    visualModeFor: (chapter, slide) => (slide === 2 && chapter <= 2 ? 'images' : 'table'),
  });
  await reachStep(page, '配图导入');
  await expect(page.getByText('当前进度：已导入 0/4，待导入 4。')).toBeVisible();

  await page.getByLabel('上传图片').first().setInputFiles(IMAGES[0]);
  await confirmDialog(page, '确认上传图片？', '确认上传');

  await page.getByLabel('批量导入图片').setInputFiles(IMAGES);
  await expect(page.getByText('准备导入 4 张图片，当前可填充槽位 3 个。')).toBeVisible();
  await confirmDialog(page, '确认批量导入图片？', '确认导入');
  await expect(page.getByText('已导入 3 张图片，超出的 1 张未使用。')).toBeVisible();
  await expect(page.getByText('当前进度：已导入 4/4，待导入 0。')).toBeVisible();
  await expect(page.getByRole('img', { name: '第4页图片2' })).toBeVisible();

  await page.getByLabel('批量导入图片').setInputFiles(IMAGES[3]);
  await expect(page.getByText('当前没有可填充的空槽位，未执行批量导入。')).toBeVisible();
});

test('AC-020 copy prompt and ITEI DRAW link', async ({ page }) => {
  await installFakeApi(page);
  await reachStep(page, '配图导入');
  await page.getByRole('button', { name: '复制图片描述' }).first().click();
  await expect(page.getByText('已复制第 4 页图片 1 的描述。')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('diagram page 4 a');

  const link = page.getByRole('link', { name: /ITEI DRAW/ });
  await expect(link).toHaveAttribute('href', 'https://draw.sensor-cloud.org/');
  await expect(link).toHaveAttribute('target', '_blank');
});

test('AC-020 no image pages', async ({ page }) => {
  await installFakeApi(page, { noImages: true });
  await reachStep(page, '配图导入');
  await expect(page.getByText('当前内容中没有需要图片的页面，可直接进入审计预览。')).toBeVisible();
  await expect(page.getByRole('link', { name: /ITEI DRAW/ })).toBeVisible();
});
