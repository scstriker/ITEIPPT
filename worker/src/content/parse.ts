import type { AISupplement, ImagePrompt, SlideTableData } from '../contracts/analyzer';
import type { GeneratedContentPayload } from './types';
import { normalizeSourceConfidence, normalizeSupplementType } from '../shared/planValues';
import { cleanText, isRecord, normalizeOptionalText } from '../shared/text';

export function normalizeRanges(ranges: unknown): Array<[number, number]> {
  if (!Array.isArray(ranges)) {
    return [];
  }
  const result: Array<[number, number]> = [];
  for (const item of ranges) {
    if (!Array.isArray(item) || item.length !== 2) {
      continue;
    }
    const start = Number(item[0]);
    const end = Number(item[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    result.push([Math.max(0, Math.floor(start)), Math.max(0, Math.floor(end))]);
  }
  return result;
}

export function normalizeTableData(raw: unknown): SlideTableData | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.headers) || !Array.isArray(raw.rows)) {
    return undefined;
  }
  const headers = raw.headers.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  const rows = raw.rows
    .map((row) => (Array.isArray(row) ? row.map((cell) => (typeof cell === 'string' ? cell.trim() : '')) : []))
    .filter((row) => row.length > 0);
  if (!headers.length || !rows.length) {
    return undefined;
  }
  return { headers, rows };
}

export function normalizeImagePrompts(raw: unknown): ImagePrompt[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const prompts: ImagePrompt[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    const iteiDrawPrompt = typeof item.iteiDrawPrompt === 'string' ? item.iteiDrawPrompt.trim() : '';
    if (!description || !iteiDrawPrompt) {
      continue;
    }
    prompts.push({ description, iteiDrawPrompt });
  }
  return prompts;
}

export function normalizeSupplements(raw: unknown): AISupplement[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const supplements: AISupplement[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (!description) {
      continue;
    }
    supplements.push({
      description,
      type: normalizeSupplementType(item.type),
    });
  }
  return supplements;
}

export function parseGeneratedContent(raw: unknown): GeneratedContentPayload {
  if (!isRecord(raw)) {
    return {};
  }

  const payload: GeneratedContentPayload = {};
  if (isRecord(raw.cover)) {
    payload.cover = {
      standardName: normalizeOptionalText(raw.cover.standardName),
      planNumber: normalizeOptionalText(raw.cover.planNumber),
      reportTitle: normalizeOptionalText(raw.cover.reportTitle),
      presenter: normalizeOptionalText(raw.cover.presenter),
      date: normalizeOptionalText(raw.cover.date),
    };
  }
  if (isRecord(raw.ending)) {
    payload.ending = {
      thanks: normalizeOptionalText(raw.ending.thanks),
      organization: normalizeOptionalText(raw.ending.organization),
      contactInfo: Array.isArray(raw.ending.contactInfo)
        ? raw.ending.contactInfo.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : undefined,
    };
  }
  if (Array.isArray(raw.slides)) {
    const parsedSlides: NonNullable<GeneratedContentPayload['slides']> = [];
    for (const item of raw.slides) {
      if (!isRecord(item)) {
        continue;
      }
      const page = Number(item.page);
      if (!Number.isFinite(page)) {
        continue;
      }
      parsedSlides.push({
        page,
        bodyText: typeof item.bodyText === 'string' ? cleanText(item.bodyText) : undefined,
        highlightRanges: normalizeRanges(item.highlightRanges),
        sourceRef: typeof item.sourceRef === 'string' ? item.sourceRef.trim() : undefined,
        sourceConfidence: normalizeSourceConfidence(item.sourceConfidence),
        aiSupplements: normalizeSupplements(item.aiSupplements),
        tableData: normalizeTableData(item.tableData),
        imagePrompts: normalizeImagePrompts(item.imagePrompts),
      });
    }
    payload.slides = parsedSlides;
  }

  return payload;
}
