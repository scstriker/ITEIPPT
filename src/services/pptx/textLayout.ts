import type { Position, TemplateElement } from '@contracts/template';
import type { SlideContent } from '@contracts/analyzer';
import { EMU_PER_INCH, PT_TO_EMU, clampNumber } from './geometry';
import { normalizeColor, resolveFont } from './textStyle';
import type { PptxTextRun } from './types';

export const SUBTITLE_PADDING_X_EMU = Math.round(0.16 * EMU_PER_INCH);

export const SUBTITLE_PADDING_Y_EMU = Math.round(0.05 * EMU_PER_INCH);

export function stripBookTitleMarkers(input: string): string {
  return input.trim().replace(/^《/, '').replace(/》$/, '');
}

export function getCoverTitleLength(title: string): number {
  return Array.from(title).length;
}

export function resolveCoverTitleFontSize(baseSize: number, title: string): number {
  const length = getCoverTitleLength(title);
  if (length > 44) {
    return Math.max(28, baseSize - 8);
  }
  if (length > 32) {
    return Math.max(32, baseSize - 4);
  }
  return baseSize;
}

export function resolveCoverTitleLineSpacing(title: string, fallback?: number): number | undefined {
  const length = getCoverTitleLength(title);
  if (length > 44) {
    return 120;
  }
  if (length > 32) {
    return 132;
  }
  return fallback;
}

export function buildCoverStandardNameRuns(title: string, element: TemplateElement): PptxTextRun[] {
  const baseSize = typeof element.size_pt === 'number' ? element.size_pt : 36;
  const resolvedSize = resolveCoverTitleFontSize(baseSize, title);
  const baseBold = typeof element.bold === 'boolean' ? element.bold : true;
  const color = normalizeColor(element.color);
  const fontFace = resolveFont(element);

  const baseOptions: Record<string, unknown> = {};
  if (fontFace) {
    baseOptions.fontFace = fontFace;
  }
  if (color) {
    baseOptions.color = color;
  }
  baseOptions.fontSize = resolvedSize;
  baseOptions.bold = baseBold;

  return [{ text: title, options: baseOptions }];
}

export function normalizeRanges(ranges: Array<[number, number]>, length: number): Array<[number, number]> {
  const normalized = ranges
    .map(([start, end]) => [Math.max(0, start), Math.min(length, end)] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  if (!normalized.length) {
    return [];
  }
  const merged: Array<[number, number]> = [];
  for (const [start, end] of normalized) {
    const last = merged[merged.length - 1];
    if (!last || start > last[1]) {
      merged.push([start, end]);
      continue;
    }
    last[1] = Math.max(last[1], end);
  }
  return merged;
}

export function buildBodyRuns(slideContent: SlideContent, bodyElement: TemplateElement): string | PptxTextRun[] {
  const normalColor = normalizeColor(bodyElement.normal_color);
  const highlightColor = normalizeColor(bodyElement.highlight_color);
  if (!normalColor || !highlightColor) {
    throw new Error('template_structure.json.content.body_text normal/highlight colors are required.');
  }

  const fontFace = resolveFont(bodyElement);
  const fontSize = bodyElement.size_pt;
  const baseBold = bodyElement.bold;

  if (slideContent.bodyRuns?.length) {
    return slideContent.bodyRuns.map((run) => ({
      text: run.text,
      options: {
        color: normalizeColor(run.color) ?? normalColor,
        bold: typeof run.bold === 'boolean' ? run.bold : baseBold,
        fontFace,
        fontSize,
      },
    }));
  }

  const bodyText = slideContent.bodyText ?? '';
  const ranges = slideContent.highlightRanges?.length ? normalizeRanges(slideContent.highlightRanges, bodyText.length) : [];
  if (!ranges.length) {
    return bodyText;
  }

  const runs: PptxTextRun[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) {
      runs.push({ text: bodyText.slice(cursor, start), options: { color: normalColor, bold: baseBold, fontFace, fontSize } });
    }
    runs.push({ text: bodyText.slice(start, end), options: { color: highlightColor, bold: baseBold, fontFace, fontSize } });
    cursor = end;
  }
  if (cursor < bodyText.length) {
    runs.push({ text: bodyText.slice(cursor), options: { color: normalColor, bold: baseBold, fontFace, fontSize } });
  }
  return runs;
}

export function normalizeSubtitleMeasurementText(input: string): string {
  return input.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function estimateSubtitleCharWeight(char: string): number {
  if (/[\u4e00-\u9fff]/u.test(char)) {
    return 1.0;
  }
  if (/[a-z0-9]/i.test(char)) {
    return 0.55;
  }
  if (/\s/.test(char)) {
    return 0.3;
  }
  if (/[，。！？；：、,.!?;:()[\]{}<>\-_/《》“”"'`]/u.test(char)) {
    return 0.6;
  }
  return 0.8;
}

export function estimateRequiredSubtitleWidthEmu(text: string, sizePt: number): number {
  const weightSum = Array.from(text).reduce((sum, char) => sum + estimateSubtitleCharWeight(char), 0);
  return Math.round(weightSum * sizePt * PT_TO_EMU + 2 * SUBTITLE_PADDING_X_EMU);
}

export function resolveSubtitleLineHeightEmu(element: TemplateElement): number {
  const sizePt = typeof element.size_pt === 'number' ? element.size_pt : 24;
  if (typeof element.line_spacing_pt === 'number') {
    return Math.max(Math.round(element.line_spacing_pt * PT_TO_EMU), Math.round(sizePt * PT_TO_EMU));
  }
  if (typeof element.line_spacing_pct === 'number') {
    return Math.max(Math.round(sizePt * (element.line_spacing_pct / 100) * PT_TO_EMU), Math.round(sizePt * PT_TO_EMU));
  }
  return Math.round(sizePt * 1.2 * PT_TO_EMU);
}

export function buildAdaptiveSubtitleLayout(
  subtitle: string,
  subTitleArea: Position,
  textArea: Position,
  subTitleElement: TemplateElement,
): { text: string; subtitlePosition: Position; bodyTextPosition: Position; subtitleElement: TemplateElement } {
  const textForMeasure = normalizeSubtitleMeasurementText(subtitle);
  const sizePt = typeof subTitleElement.size_pt === 'number' ? subTitleElement.size_pt : 24;

  const minWidth = subTitleArea.width_emu;
  const maxWidth = Math.max(minWidth, textArea.left_emu + textArea.width_emu - subTitleArea.left_emu);
  const requiredWidth = estimateRequiredSubtitleWidthEmu(textForMeasure, sizePt);
  const actualWidth = clampNumber(requiredWidth, minWidth, maxWidth);

  const exceedsSingleLine = requiredWidth > maxWidth;
  const lineCount = exceedsSingleLine ? Math.max(2, Math.ceil(requiredWidth / maxWidth)) : 1;
  const lineHeightEmu = resolveSubtitleLineHeightEmu(subTitleElement);
  const actualHeight = exceedsSingleLine
    ? Math.max(subTitleArea.height_emu, lineCount * lineHeightEmu + 2 * SUBTITLE_PADDING_Y_EMU)
    : subTitleArea.height_emu;

  const subtitlePosition: Position = {
    ...subTitleArea,
    width_emu: Math.round(actualWidth),
    height_emu: Math.round(actualHeight),
  };

  const baseGap = Math.max(0, textArea.top_emu - (subTitleArea.top_emu + subTitleArea.height_emu));
  const subtitleBottom = subtitlePosition.top_emu + subtitlePosition.height_emu;
  const bodyBottom = textArea.top_emu + textArea.height_emu;
  const adjustedBodyTop = Math.max(textArea.top_emu, subtitleBottom + baseGap);
  const adjustedBodyHeight = Math.max(PT_TO_EMU, bodyBottom - adjustedBodyTop);
  const bodyTextPosition: Position = {
    ...textArea,
    top_emu: Math.round(adjustedBodyTop),
    height_emu: Math.round(adjustedBodyHeight),
  };

  return {
    text: subtitle,
    subtitlePosition,
    bodyTextPosition,
    subtitleElement: {
      ...subTitleElement,
      word_wrap: true,
    },
  };
}
