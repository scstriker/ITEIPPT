// AC-023: export preflight and render input.
import { describe, expect, it } from 'vitest';
import type { AnalyzerResult } from '@contracts/analyzer';
import {
  buildRiskSummary,
  computeExportStats,
  computePreflight,
  prepareRenderInput,
} from '../features/export/exportPreflight';

const result = {
  slidePlan: [
    { page: 1, type: 'cover' },
    { page: 2, type: 'content', visualMode: 'table', bodyText: '短' },
    { page: 3, type: 'content', visualMode: 'images', bodyText: '超'.repeat(151), imagePrompts: [{ description: 'a', iteiDrawPrompt: 'a' }, { description: 'b', iteiDrawPrompt: 'b' }] },
    { page: 4, type: 'content', visualMode: 'images', bodyText: '字'.repeat(150), imagePrompts: [{ description: 'c', iteiDrawPrompt: 'c' }] },
    { page: 5, type: 'ending' },
  ],
} as AnalyzerResult;

const png = () => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });

describe('export preflight', () => {
  it('counts slides and image pages', () => {
    expect(computeExportStats(result)).toEqual({ totalSlides: 5, imageSlideCount: 2 });
  });

  it('reports missing slots and over-limit pages', () => {
    const imported = new Map([['page-3-slot-1', png()]]);
    const preflight = computePreflight(result, imported);
    expect(preflight).toEqual({ imageSlotTotal: 3, importedImageTotal: 1, missingImageTotal: 2, overLimitPages: [3] });
    expect(buildRiskSummary(preflight)).toBe('缺少 2 个图片槽位；页面 3 正文超 150 字');
    expect(buildRiskSummary({ imageSlotTotal: 0, importedImageTotal: 0, missingImageTotal: 0, overLimitPages: [] })).toBe(
      '当前未发现高风险项。',
    );
  });

  it('attaches imported images without touching the original slides', async () => {
    const imported = new Map([['page-3-slot-1', png()]]);
    const { slides, imageFiles } = await prepareRenderInput(result, imported);
    expect(slides[2].images).toEqual([{ key: 'page-3-slot-1', mimeType: 'image/png' }]);
    expect(slides[2].imageFiles).toEqual(['page-3-slot-1']);
    expect(slides[3].images).toBeUndefined();
    expect(result.slidePlan[2].images).toBeUndefined();
    expect([...imageFiles.keys()]).toEqual(['page-3-slot-1']);
  });
});
