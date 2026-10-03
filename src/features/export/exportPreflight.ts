import type { AnalyzerResult, SlideContent } from '@contracts/analyzer';
import type { ImageFileMap } from '../../services/pptx/renderPptx';
import { getImageSlotKey } from '../images/imageSlots';

export const OUTPUT_FILENAME = 'ITEIPPT_v2_output.pptx';
export const BODY_TEXT_SOFT_LIMIT = 150;

export interface ExportStats {
  totalSlides: number;
  imageSlideCount: number;
}

export interface ExportPreflight {
  imageSlotTotal: number;
  importedImageTotal: number;
  missingImageTotal: number;
  overLimitPages: number[];
}

export function computeExportStats(result: AnalyzerResult): ExportStats {
  return {
    totalSlides: result.slidePlan.length,
    imageSlideCount: result.slidePlan.filter((slide) => slide.type === 'content' && slide.visualMode === 'images').length,
  };
}

export function computePreflight(result: AnalyzerResult, importedImages: Map<string, File>): ExportPreflight {
  let imageSlotTotal = 0;
  let importedImageTotal = 0;
  const overLimitPages: number[] = [];

  for (const slide of result.slidePlan) {
    if (slide.type !== 'content') {
      continue;
    }

    if ((slide.bodyText ?? '').length > BODY_TEXT_SOFT_LIMIT) {
      overLimitPages.push(slide.page);
    }

    if (slide.visualMode !== 'images') {
      continue;
    }

    const promptCount = slide.imagePrompts?.length ?? 0;
    imageSlotTotal += promptCount;
    for (let slotIndex = 0; slotIndex < promptCount; slotIndex += 1) {
      if (importedImages.has(getImageSlotKey(slide.page, slotIndex))) {
        importedImageTotal += 1;
      }
    }
  }

  return {
    imageSlotTotal,
    importedImageTotal,
    missingImageTotal: Math.max(0, imageSlotTotal - importedImageTotal),
    overLimitPages,
  };
}

export function buildRiskSummary(preflight: ExportPreflight): string {
  const parts: string[] = [];
  if (preflight.missingImageTotal) {
    parts.push(`缺少 ${preflight.missingImageTotal} 个图片槽位`);
  }
  if (preflight.overLimitPages.length) {
    parts.push(`页面 ${preflight.overLimitPages.join(', ')} 正文超 ${BODY_TEXT_SOFT_LIMIT} 字`);
  }
  return parts.length ? parts.join('；') : '当前未发现高风险项。';
}

/** Copy slides and attach imported image bytes for the renderer, keyed by slot. */
export async function prepareRenderInput(
  result: AnalyzerResult,
  importedImages: Map<string, File>,
): Promise<{ slides: SlideContent[]; imageFiles: ImageFileMap }> {
  const imageFiles: ImageFileMap = new Map();
  const slides = result.slidePlan.map((slide) => ({ ...slide }));

  for (const slide of slides) {
    if (slide.type !== 'content' || slide.visualMode !== 'images') {
      continue;
    }
    const prompts = slide.imagePrompts ?? [];
    const images: NonNullable<SlideContent['images']> = [];
    for (let slotIndex = 0; slotIndex < prompts.length; slotIndex += 1) {
      const key = getImageSlotKey(slide.page, slotIndex);
      const file = importedImages.get(key);
      if (!file) {
        continue;
      }
      const buffer = await file.arrayBuffer();
      imageFiles.set(key, buffer);
      images.push({
        key,
        mimeType: file.type || 'image/png',
      });
    }
    if (images.length) {
      slide.images = images;
      slide.imageFiles = images.map((img) => img.key ?? '');
    }
  }

  return { slides, imageFiles };
}
