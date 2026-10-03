// AC-018 / AC-019: image slot rules.
import { describe, expect, it } from 'vitest';
import type { AnalyzerResult, SlideContent } from '@contracts/analyzer';
import {
  bulkImportMessage,
  getImageSlotKey,
  getSlidePrompts,
  listImageSlides,
  listImageSlots,
  planBulkImport,
  validateImageFile,
} from '../features/images/imageSlots';

function file(name: string, type: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}

const slides: SlideContent[] = [
  { page: 3, type: 'content', visualMode: 'table' },
  { page: 4, type: 'content', visualMode: 'images', imagePrompts: [{ description: 'a', iteiDrawPrompt: 'a' }, { description: 'b', iteiDrawPrompt: 'b' }] },
  { page: 7, type: 'content', visualMode: 'images' },
];

describe('image slots', () => {
  it('builds slot keys', () => {
    expect(getImageSlotKey(4, 1)).toBe('page-4-slot-1');
  });

  it('lists image pages and gives prompt-less pages one slot', () => {
    const imageSlides = listImageSlides({ slidePlan: slides } as AnalyzerResult);
    expect(imageSlides.map((slide) => slide.page)).toEqual([4, 7]);
    expect(getSlidePrompts(slides[2])).toEqual([{ description: '图片描述待生成', iteiDrawPrompt: '' }]);
    expect(listImageSlots(imageSlides).map((slot) => slot.key)).toEqual(['page-4-slot-0', 'page-4-slot-1', 'page-7-slot-0']);
    expect(listImageSlides(null)).toEqual([]);
  });

  it('validates type and size', () => {
    expect(validateImageFile(file('a.png', 'image/png'))).toBeNull();
    expect(validateImageFile(file('a.txt', 'text/plain'))).toBe('文件“a.txt”不是图片格式，请重新选择。');
    expect(validateImageFile(file('big.png', 'image/png', 12 * 1024 * 1024 + 1))).toBe('文件“big.png”超过 12MB，请压缩后再上传。');
  });

  it('plans bulk import into empty slots in page order', () => {
    const slots = listImageSlots(listImageSlides({ slidePlan: slides } as AnalyzerResult));
    const imported = new Map([['page-4-slot-0', file('x.png', 'image/png')]]);
    const plan = planBulkImport(slots, imported, 4);
    expect(plan).toEqual({ targetKeys: ['page-4-slot-1', 'page-7-slot-0'], availableSlots: 2, unusedFiles: 2 });
    expect(bulkImportMessage(plan)).toBe('已导入 2 张图片，超出的 2 张未使用。');
    expect(bulkImportMessage(planBulkImport(slots, imported, 1))).toBe('已批量导入 1 张图片。');
    expect(planBulkImport(slots, new Map(slots.map((slot) => [slot.key, file('y.png', 'image/png')])), 3).targetKeys).toEqual([]);
  });
});
