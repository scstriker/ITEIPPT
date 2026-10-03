import type { AnalyzerResult, ImagePrompt, SlideContent } from '@contracts/analyzer';

export const MAX_IMAGE_FILE_MB = 12;

export interface ImageSlot {
  page: number;
  slotIndex: number;
  key: string;
}

export function getImageSlotKey(page: number, slotIndex: number): string {
  return `page-${page}-slot-${slotIndex}`;
}

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) {
    return `文件“${file.name}”不是图片格式，请重新选择。`;
  }
  const maxSizeBytes = MAX_IMAGE_FILE_MB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return `文件“${file.name}”超过 ${MAX_IMAGE_FILE_MB}MB，请压缩后再上传。`;
  }
  return null;
}

export function listImageSlides(result: AnalyzerResult | null): SlideContent[] {
  return (result?.slidePlan ?? []).filter((slide) => slide.type === 'content' && slide.visualMode === 'images');
}

/** Image prompts of a slide; a slide without prompts still gets one empty slot. */
export function getSlidePrompts(slide: SlideContent): ImagePrompt[] {
  if (slide.imagePrompts?.length) {
    return slide.imagePrompts;
  }
  return [
    {
      description: '图片描述待生成',
      iteiDrawPrompt: '',
    },
  ];
}

export function listImageSlots(imageSlides: SlideContent[]): ImageSlot[] {
  return imageSlides.flatMap((slide) =>
    getSlidePrompts(slide).map((_, slotIndex) => ({
      page: slide.page,
      slotIndex,
      key: getImageSlotKey(slide.page, slotIndex),
    })),
  );
}

export interface BulkImportPlan {
  /** Slot keys to fill, in page order, paired with files[0..applied). */
  targetKeys: string[];
  availableSlots: number;
  unusedFiles: number;
}

/** Fill empty slots in page order; files beyond the empty slots are not used. */
export function planBulkImport(slots: ImageSlot[], imported: Map<string, File>, fileCount: number): BulkImportPlan {
  const emptySlots = slots.filter((slot) => !imported.has(slot.key));
  const applied = Math.min(emptySlots.length, fileCount);
  return {
    targetKeys: emptySlots.slice(0, applied).map((slot) => slot.key),
    availableSlots: emptySlots.length,
    unusedFiles: Math.max(0, fileCount - applied),
  };
}

export function bulkImportMessage(plan: BulkImportPlan): string {
  const applied = plan.targetKeys.length;
  return plan.unusedFiles > 0
    ? `已导入 ${applied} 张图片，超出的 ${plan.unusedFiles} 张未使用。`
    : `已批量导入 ${applied} 张图片。`;
}
