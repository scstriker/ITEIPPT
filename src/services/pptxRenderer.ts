import PptxGenJSImport from 'pptxgenjs';
import type { BackgroundAssets } from '../config/assets';
import {
  emuToInches,
  getReferenceSlide,
  getSlideType,
  getTemplate,
  positionToInches,
} from '../config/templateLoader';
import type {
  Position,
  PptxPosition,
  SlideTypeDefinition,
  TemplateElement,
  TemplateParagraph,
  TemplateShape,
  VisualMode,
} from '@contracts/template';
import type {
  SlideContent,
  SlideImageData,
} from '@contracts/analyzer';
export type { SlideContent } from '@contracts/analyzer';

type PptxGenJSConstructor = typeof PptxGenJSImport;
const PptxGenJS: PptxGenJSConstructor =
  (PptxGenJSImport as unknown as { default?: PptxGenJSConstructor }).default ?? PptxGenJSImport;

type PptxSlide = ReturnType<InstanceType<PptxGenJSConstructor>['addSlide']>;
type PptxTextRun = { text: string; options?: Record<string, unknown> };

export type ImageFileMap = Map<string, ArrayBuffer | Uint8Array | Blob | string>;

interface TextPlacement {
  text: string | PptxTextRun[];
  position: Position;
  element?: TemplateElement;
  paragraphStyle?: TemplateParagraph;
  colorOverride?: string;
  rotation?: number;
}

interface PositionBounds {
  minLeft: number;
  minTop: number;
  width: number;
  height: number;
}

interface TocShapeNode {
  shape: TemplateShape;
  position: Position;
}

interface TocRunStyle {
  paragraph?: TemplateParagraph;
}

interface TocRowLayout {
  numberNode: TocShapeNode;
  titleNode: TocShapeNode;
  badgeNode: TocShapeNode;
  circleNode: TocShapeNode;
  barNode: TocShapeNode;
  dividerNode: TocShapeNode;
  dividerRotation?: number;
  numberRotation?: number;
  numberStyle?: TocRunStyle;
  titleStyle?: TocRunStyle;
  badgeColor?: string;
}

interface TableReferenceStyle {
  colWidthsInches: number[];
  rowHeightsInches: number[];
  headerFillColor: string;
  headerFontColor: string;
  dataRowFillPattern: string[];
}

const SCHEME_COLOR_MAP: Record<string, string> = {
  'scheme:bg1': 'FFFFFF',
  'scheme:tx1': '000000',
};
const EMU_PER_INCH = 914400;
const PT_TO_EMU = 12700;
const SUBTITLE_PADDING_X_EMU = Math.round(0.16 * EMU_PER_INCH);
const SUBTITLE_PADDING_Y_EMU = Math.round(0.05 * EMU_PER_INCH);

function normalizeColor(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim();
  if (!value) {
    return undefined;
  }
  if (value.startsWith('#')) {
    return value.slice(1).toUpperCase();
  }
  if (/^scheme:/i.test(value)) {
    return SCHEME_COLOR_MAP[value.toLowerCase()];
  }
  if (/^[0-9a-f]{6}$/i.test(value)) {
    return value.toUpperCase();
  }
  return undefined;
}

function normalizeAlign(raw?: string): 'left' | 'center' | 'right' | 'justify' | 'dist' | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.toLowerCase();
  if (value === 'distribute') {
    return 'dist';
  }
  if (value === 'left' || value === 'center' || value === 'right' || value === 'justify' || value === 'dist') {
    return value;
  }
  return undefined;
}

function resolveFont(element?: TemplateElement): string | undefined {
  if (!element) {
    return undefined;
  }
  return element.font_chinese ?? element.font ?? element.font_latin;
}

function toPptxDataUrl(input: string, mimeType = 'image/jpeg'): string {
  const trimmed = input.replace(/^\uFEFF/, '').replace(/\s+/g, '').trim();
  if (trimmed.startsWith('image/')) {
    return trimmed;
  }
  if (trimmed.startsWith('data:image/')) {
    return trimmed.replace(/^data:/, '');
  }
  return `${mimeType};base64,${trimmed}`;
}

function arrayBufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function cmToInches(value: number): number {
  return value / 2.54;
}

async function resolveImageData(image: SlideImageData | undefined, imageFiles: ImageFileMap): Promise<string | undefined> {
  if (!image) {
    return undefined;
  }
  if (image.data) {
    return toPptxDataUrl(image.data, image.mimeType ?? 'image/jpeg');
  }
  if (!image.key || !imageFiles.has(image.key)) {
    return undefined;
  }
  const source = imageFiles.get(image.key);
  if (!source) {
    return undefined;
  }
  if (typeof source === 'string') {
    return toPptxDataUrl(source, image.mimeType ?? 'image/jpeg');
  }
  if (source instanceof Blob) {
    const buffer = await source.arrayBuffer();
    return `${image.mimeType ?? 'image/jpeg'};base64,${arrayBufferToBase64(buffer)}`;
  }
  if (source instanceof Uint8Array) {
    return `${image.mimeType ?? 'image/jpeg'};base64,${arrayBufferToBase64(source.buffer as ArrayBuffer)}`;
  }
  return `${image.mimeType ?? 'image/jpeg'};base64,${arrayBufferToBase64(source)}`;
}

function findElement(def: SlideTypeDefinition, role: string): TemplateElement | undefined {
  return def.elements.find((item) => item.role === role);
}

function getFirstParagraph(shape: TemplateShape): TemplateParagraph | undefined {
  const paragraph = shape.text_frame?.paragraphs?.[0];
  if (!paragraph || typeof paragraph === 'string') {
    return undefined;
  }
  return paragraph;
}

function applyParagraphStyle(options: Record<string, unknown>, paragraph: TemplateParagraph | undefined): void {
  if (!paragraph) {
    return;
  }
  const align = normalizeAlign(paragraph.alignment);
  if (align) {
    options.align = align;
  }
  if (typeof paragraph.line_spacing_pt === 'number') {
    options.lineSpacing = paragraph.line_spacing_pt;
  }
  if (typeof paragraph.line_spacing_pct === 'number') {
    options.lineSpacingMultiple = paragraph.line_spacing_pct / 100;
  }
  if (typeof paragraph.space_before_pt === 'number') {
    options.paraSpaceBefore = paragraph.space_before_pt;
  }
  if (typeof paragraph.space_after_pt === 'number') {
    options.paraSpaceAfter = paragraph.space_after_pt;
  }
}

function applyElementTextStyle(options: Record<string, unknown>, element: TemplateElement | undefined): void {
  if (!element) {
    return;
  }
  const fontFace = resolveFont(element);
  const color = normalizeColor(element.color);
  const align = normalizeAlign(element.alignment);
  if (fontFace) {
    options.fontFace = fontFace;
  }
  if (typeof element.size_pt === 'number') {
    options.fontSize = element.size_pt;
  }
  if (typeof element.bold === 'boolean') {
    options.bold = element.bold;
  }
  if (color) {
    options.color = color;
  }
  if (align) {
    options.align = align;
  }
  if (typeof element.line_spacing_pt === 'number') {
    options.lineSpacing = element.line_spacing_pt;
  }
  if (typeof element.line_spacing_pct === 'number') {
    options.lineSpacingMultiple = element.line_spacing_pct / 100;
  }
  if (typeof element.space_before_pt === 'number') {
    options.paraSpaceBefore = element.space_before_pt;
  }
  if (typeof element.space_after_pt === 'number') {
    options.paraSpaceAfter = element.space_after_pt;
  }
  if (typeof element.word_wrap === 'boolean') {
    options.wrap = element.word_wrap;
  }
}

function addTemplateText(slide: PptxSlide, placement: TextPlacement): void {
  const { text, position, element, paragraphStyle, colorOverride, rotation } = placement;
  const options: Record<string, unknown> = {
    ...positionToInches(position),
    margin: 0,
  };
  applyElementTextStyle(options, element);
  applyParagraphStyle(options, paragraphStyle);
  const override = normalizeColor(colorOverride);
  if (override) {
    options.color = override;
  }
  if (typeof rotation === 'number') {
    options.rotate = rotation;
  }
  slide.addText(text as never, options as never);
}

function getPositionBounds(shapes: TemplateShape[]): PositionBounds | null {
  const withPosition = shapes.filter((item) => !!item.position) as Array<TemplateShape & { position: Position }>;
  if (!withPosition.length) {
    return null;
  }
  let minLeft = Number.POSITIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;
  for (const shape of withPosition) {
    minLeft = Math.min(minLeft, shape.position.left_emu);
    minTop = Math.min(minTop, shape.position.top_emu);
    maxRight = Math.max(maxRight, shape.position.left_emu + shape.position.width_emu);
    maxBottom = Math.max(maxBottom, shape.position.top_emu + shape.position.height_emu);
  }
  return {
    minLeft,
    minTop,
    width: Math.max(1, maxRight - minLeft),
    height: Math.max(1, maxBottom - minTop),
  };
}

function transformChildPosition(parent: Position, child: Position, bounds: PositionBounds): Position {
  const relLeft = (child.left_emu - bounds.minLeft) / bounds.width;
  const relTop = (child.top_emu - bounds.minTop) / bounds.height;
  const relWidth = child.width_emu / bounds.width;
  const relHeight = child.height_emu / bounds.height;
  return {
    left_emu: parent.left_emu + parent.width_emu * relLeft,
    top_emu: parent.top_emu + parent.height_emu * relTop,
    width_emu: parent.width_emu * relWidth,
    height_emu: parent.height_emu * relHeight,
  };
}

function resolveGroupChildrenAbs(
  parentPosition: Position,
  children: TemplateShape[] | undefined,
): Array<{ shape: TemplateShape; position: Position }> {
  if (!children?.length) {
    return [];
  }
  const bounds = getPositionBounds(children);
  if (!bounds) {
    return [];
  }
  return children
    .filter((child) => !!child.position)
    .map((child) => ({
      shape: child,
      position: transformChildPosition(parentPosition, child.position as Position, bounds),
    }));
}

function getShapeText(shape: TemplateShape): string {
  return typeof shape.text_frame?.text === 'string' ? shape.text_frame.text : '';
}

function getShapeFillColor(shape: TemplateShape): string | undefined {
  return normalizeColor(
    typeof shape.fill_color === 'string'
      ? shape.fill_color
      : typeof shape.fill === 'string'
        ? shape.fill
        : undefined,
  );
}

function expectTocNode(node: TocShapeNode | undefined, message: string): TocShapeNode {
  if (!node) {
    throw new Error(`template_structure.json.toc_section invalid: ${message}`);
  }
  return node;
}

function getTocRowLayoutsStrict(): TocRowLayout[] {
  const referenceSlide = getReferenceSlide('toc_section', (slide) => !!slide.shapes?.length);
  const groups = (referenceSlide.shapes ?? [])
    .filter((shape) => shape.shape_type === 'group' && !!shape.position)
    .map((shape) => shape as TemplateShape & { position: Position })
    .filter((shape) =>
      (shape.children ?? []).some((child) => {
        const text = child.text_frame?.text;
        return typeof text === 'string' && /(\d{1,2}|、)/.test(text);
      }),
    )
    .sort((a, b) => a.position.top_emu - b.position.top_emu);

  if (!groups.length) {
    throw new Error('template_structure.json.toc_section missing row groups.');
  }

  const layouts: TocRowLayout[] = [];
  for (const group of groups) {
    const childNodes = resolveGroupChildrenAbs(group.position, group.children);
    const numberNode = childNodes.find((node) => /^\s*\d{1,2}\s*$/.test(getShapeText(node.shape)));
    const titleNode = childNodes.find((node) => {
      const text = getShapeText(node.shape);
      return !!text && !/^\s*\d{1,2}\s*$/.test(text);
    });
    const geometryGroup = childNodes.find((node) => node.shape.shape_type === 'group');
    if (!geometryGroup) {
      throw new Error('template_structure.json.toc_section group missing geometry subgroup.');
    }

    const geometryChildren = resolveGroupChildrenAbs(geometryGroup.position, geometryGroup.shape.children);
    const badgeNode = geometryChildren.find((node) => node.shape.name?.includes('任意多边形'));
    const circleNode = geometryChildren.find((node) => node.shape.auto_shape_type === 'ellipse');
    const barNode = geometryChildren.find((node) => node.shape.name?.includes('矩形'));
    const dividerNode = geometryChildren.find((node) => node.shape.auto_shape_type === 'rtTriangle');

    layouts.push({
      numberNode: expectTocNode(numberNode, 'row number text is missing'),
      titleNode: expectTocNode(titleNode, 'row title text is missing'),
      badgeNode: expectTocNode(badgeNode, 'row badge shape is missing'),
      circleNode: expectTocNode(circleNode, 'row circle shape is missing'),
      barNode: expectTocNode(barNode, 'row bar shape is missing'),
      dividerNode: expectTocNode(dividerNode, 'row divider shape is missing'),
      dividerRotation: typeof dividerNode?.shape.rotation === 'number' ? dividerNode.shape.rotation : undefined,
      numberRotation: typeof numberNode?.shape.rotation === 'number' ? numberNode.shape.rotation : undefined,
      numberStyle: { paragraph: numberNode ? getFirstParagraph(numberNode.shape) : undefined },
      titleStyle: { paragraph: titleNode ? getFirstParagraph(titleNode.shape) : undefined },
      badgeColor: badgeNode ? getShapeFillColor(badgeNode.shape) : undefined,
    });
  }

  return layouts;
}

function getContentTableReferenceStyleStrict(): TableReferenceStyle {
  const referenceSlide = getReferenceSlide('content', (slide) => !!slide.shapes?.length);

  const findTable = (shapes: TemplateShape[] | undefined): TemplateShape | undefined => {
    if (!shapes?.length) {
      return undefined;
    }
    for (const shape of shapes) {
      if (shape.shape_type === 'table' && shape.table?.rows?.length) {
        return shape;
      }
      const nested = findTable(shape.children);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  };

  const tableShape = findTable(referenceSlide.shapes);
  if (!tableShape?.table?.rows?.length) {
    throw new Error('template_structure.json.content missing reference table with rows.');
  }

  const table = tableShape.table;
  const rows = tableShape.table.rows;
  const headerCell = rows[0]?.[0];
  const headerFillColor = normalizeColor(headerCell?.fill_color);
  if (!headerFillColor) {
    throw new Error('template_structure.json.content table header fill color is missing.');
  }

  const headerParagraph = headerCell?.paragraphs?.[0];
  const headerRun =
    headerParagraph && typeof headerParagraph !== 'string' && headerParagraph.runs?.length
      ? headerParagraph.runs[0]
      : undefined;
  const headerFontColor =
    headerRun && typeof headerRun !== 'string'
      ? normalizeColor(typeof headerRun.font_color === 'string' ? headerRun.font_color : undefined)
      : undefined;
  if (!headerFontColor) {
    throw new Error('template_structure.json.content table header font color is missing.');
  }

  const dataRowFillPattern = rows
    .slice(1)
    .map((row) => normalizeColor(row[0]?.fill_color))
    .filter((value): value is string => !!value)
    .filter((value, idx, list) => list.indexOf(value) === idx);
  if (!dataRowFillPattern.length) {
    throw new Error('template_structure.json.content table data row fill pattern is missing.');
  }

  const colWidthsInches = (table.col_widths_cm ?? []).map((value) => cmToInches(value));
  const rowHeightsInches = (table.row_heights_cm ?? []).map((value) => cmToInches(value));

  return {
    colWidthsInches,
    rowHeightsInches,
    headerFillColor,
    headerFontColor,
    dataRowFillPattern,
  };
}

function stripBookTitleMarkers(input: string): string {
  return input.trim().replace(/^《/, '').replace(/》$/, '');
}

function getCoverTitleLength(title: string): number {
  return Array.from(title).length;
}

function resolveCoverTitleFontSize(baseSize: number, title: string): number {
  const length = getCoverTitleLength(title);
  if (length > 44) {
    return Math.max(28, baseSize - 8);
  }
  if (length > 32) {
    return Math.max(32, baseSize - 4);
  }
  return baseSize;
}

function resolveCoverTitleLineSpacing(title: string, fallback?: number): number | undefined {
  const length = getCoverTitleLength(title);
  if (length > 44) {
    return 120;
  }
  if (length > 32) {
    return 132;
  }
  return fallback;
}

function buildCoverStandardNameRuns(title: string, element: TemplateElement): PptxTextRun[] {
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

function normalizeRanges(ranges: Array<[number, number]>, length: number): Array<[number, number]> {
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

function buildBodyRuns(slideContent: SlideContent, bodyElement: TemplateElement): string | PptxTextRun[] {
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeSubtitleMeasurementText(input: string): string {
  return input.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function estimateSubtitleCharWeight(char: string): number {
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

function estimateRequiredSubtitleWidthEmu(text: string, sizePt: number): number {
  const weightSum = Array.from(text).reduce((sum, char) => sum + estimateSubtitleCharWeight(char), 0);
  return Math.round(weightSum * sizePt * PT_TO_EMU + 2 * SUBTITLE_PADDING_X_EMU);
}

function resolveSubtitleLineHeightEmu(element: TemplateElement): number {
  const sizePt = typeof element.size_pt === 'number' ? element.size_pt : 24;
  if (typeof element.line_spacing_pt === 'number') {
    return Math.max(Math.round(element.line_spacing_pt * PT_TO_EMU), Math.round(sizePt * PT_TO_EMU));
  }
  if (typeof element.line_spacing_pct === 'number') {
    return Math.max(Math.round(sizePt * (element.line_spacing_pct / 100) * PT_TO_EMU), Math.round(sizePt * PT_TO_EMU));
  }
  return Math.round(sizePt * 1.2 * PT_TO_EMU);
}

function buildAdaptiveSubtitleLayout(
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

function renderCoverSlide(slide: PptxSlide, slideContent: SlideContent, def: SlideTypeDefinition): void {
  const textByRole: Record<string, string | undefined> = {
    main_title: slideContent.reportTitle,
    date: slideContent.date,
    reporter: slideContent.presenter,
    organization: slideContent.organization,
  };

  for (const element of def.elements) {
    if (!element.position) {
      continue;
    }

    if (element.role === 'standard_name') {
      const title = stripBookTitleMarkers(slideContent.standardName ?? '').trim();
      if (!title) {
        continue;
      }
      const lineSpacingPct = resolveCoverTitleLineSpacing(title, element.line_spacing_pct);
      const titleElement = lineSpacingPct ? { ...element, line_spacing_pct: lineSpacingPct } : element;
      addTemplateText(slide, {
        text: buildCoverStandardNameRuns(title, titleElement),
        position: element.position,
        element: titleElement,
      });
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(textByRole, element.role)) {
      const text = textByRole[element.role]?.trim();
      if (!text) {
        continue;
      }
      addTemplateText(slide, { text, position: element.position, element });
      continue;
    }

    const fallbackText = element.description?.trim();
    if (!fallbackText) {
      continue;
    }
    addTemplateText(slide, { text: fallbackText, position: element.position, element });
  }
}

function renderTocSectionSlide(slide: PptxSlide, slideContent: SlideContent, def: SlideTypeDefinition): void {
  const template = getTemplate();
  const pageTitleElement = findElement(def, 'page_title');
  const sectionElement = findElement(def, 'section_items');
  if (!pageTitleElement?.position || !sectionElement?.items?.length) {
    throw new Error('template_structure.json.toc_section missing required page_title/section_items.');
  }

  addTemplateText(slide, {
    text: slideContent.pageTitle ?? pageTitleElement.description ?? '',
    position: pageTitleElement.position,
    element: pageTitleElement,
  });

  const sectionItems = (slideContent.sectionItems?.length ? slideContent.sectionItems : sectionElement.items).map((item, idx) => ({
    number: typeof item.number === 'string' ? item.number : `${idx + 1}`.padStart(2, '0'),
    title: typeof item.title === 'string' ? item.title : '',
  }));

  const layouts = getTocRowLayoutsStrict();
  if (layouts.length < sectionItems.length) {
    throw new Error('template_structure.json.toc_section row layouts are fewer than section items.');
  }

  const highlightColor = normalizeColor(template.presentation.theme_colors.highlight_red);
  const barColor = normalizeColor(template.presentation.theme_colors.primary_blue);
  const defaultBadgeColor = layouts.map((item) => item.badgeColor).find((color) => !!color && color !== highlightColor);
  if (!highlightColor || !barColor || !defaultBadgeColor) {
    throw new Error('template_structure.json.toc_section missing required colors.');
  }

  const highlightIndex = (slideContent.highlightChapter ?? 1) - 1;

  for (let index = 0; index < sectionItems.length; index += 1) {
    const item = sectionItems[index];
    const layout = layouts[index];
    const isHighlight = index === highlightIndex;
    const currentBarColor = isHighlight ? highlightColor : barColor;
    const currentBadgeColor = isHighlight ? highlightColor : defaultBadgeColor;

    slide.addShape('rect', {
      ...positionToInches(layout.barNode.position),
      fill: { color: currentBarColor },
      line: { color: currentBarColor, transparency: 100 },
    });
    slide.addShape('parallelogram', {
      ...positionToInches(layout.badgeNode.position),
      fill: { color: currentBadgeColor },
      line: { color: currentBadgeColor, transparency: 100 },
    });
    slide.addShape('ellipse', {
      ...positionToInches(layout.circleNode.position),
      fill: { color: currentBadgeColor },
      line: { color: currentBadgeColor, transparency: 100 },
    });
    slide.addShape('rtTriangle', {
      ...positionToInches(layout.dividerNode.position),
      rotate: layout.dividerRotation,
      fill: { color: 'FFFFFF' },
      line: { color: 'FFFFFF', transparency: 100 },
    });

    addTemplateText(slide, {
      text: item.number ?? '',
      position: layout.numberNode.position,
      element: sectionElement,
      paragraphStyle: layout.numberStyle?.paragraph,
      colorOverride: sectionElement.color ?? 'scheme:bg1',
      rotation: layout.numberRotation,
    });
    addTemplateText(slide, {
      text: item.title ?? '',
      position: layout.titleNode.position,
      element: sectionElement,
      paragraphStyle: layout.titleStyle?.paragraph,
      colorOverride: sectionElement.color ?? 'scheme:bg1',
    });
  }
}

function renderContentTextRegions(slide: PptxSlide, slideContent: SlideContent, def: SlideTypeDefinition): void {
  const zones = def.layout_zones ?? {};
  const topBar = zones.top_bar?.position;
  const subTitleArea = zones.sub_title_area?.position;
  const textArea = zones.text_content_area?.position;
  if (!topBar || !subTitleArea || !textArea) {
    throw new Error('template_structure.json.content.layout_zones missing required text regions.');
  }

  const sectionTitleElement = findElement(def, 'section_title');
  const subTitleElement = findElement(def, 'sub_title');
  const bodyTextElement = findElement(def, 'body_text');
  if (!subTitleElement || !bodyTextElement) {
    throw new Error('template_structure.json.content missing sub_title/body_text elements.');
  }

  if (sectionTitleElement) {
    addTemplateText(slide, {
      text: slideContent.chapterTitle ?? '',
      position: topBar,
      element: sectionTitleElement,
    });
  }

  const subTitleFill = normalizeColor(subTitleElement.fill_color);
  if (!subTitleFill) {
    throw new Error('template_structure.json.content.sub_title.fill_color is required.');
  }
  const adaptiveSubtitle = buildAdaptiveSubtitleLayout(slideContent.subtitle ?? '', subTitleArea, textArea, subTitleElement);
  slide.addShape('rect', {
    ...positionToInches(adaptiveSubtitle.subtitlePosition),
    fill: { color: subTitleFill },
    line: { color: subTitleFill, transparency: 100 },
  });
  addTemplateText(slide, {
    text: adaptiveSubtitle.text,
    position: adaptiveSubtitle.subtitlePosition,
    element: adaptiveSubtitle.subtitleElement,
  });

  const bodyValue = buildBodyRuns(slideContent, bodyTextElement);
  addTemplateText(slide, {
    text: bodyValue,
    position: adaptiveSubtitle.bodyTextPosition,
    element: bodyTextElement,
    colorOverride: typeof bodyValue === 'string' ? bodyTextElement.normal_color : undefined,
  });
}

function renderTableInVisualArea(slide: PptxSlide, slideContent: SlideContent, def: SlideTypeDefinition): void {
  if (!slideContent.tableData) {
    return;
  }
  const tableMode = def.visual_area_modes?.table;
  if (!tableMode?.default_position) {
    throw new Error('template_structure.json.content.visual_area_modes.table.default_position is required.');
  }

  const referenceStyle = getContentTableReferenceStyleStrict();
  const bodyElement = findElement(def, 'body_text');
  const tablePos = positionToInches(tableMode.default_position);

  const headerFillColor = normalizeColor(slideContent.tableData.headerFillColor) ?? referenceStyle.headerFillColor;
  const headerFontColor = referenceStyle.headerFontColor;

  const headerRow = slideContent.tableData.headers.map((cell) => ({
    text: cell,
    options: {
      bold: true,
      color: headerFontColor,
      fill: { color: headerFillColor },
    },
  }));

  const dataRows = slideContent.tableData.rows.map((row, rowIdx) => {
    const fillColor = referenceStyle.dataRowFillPattern[rowIdx % referenceStyle.dataRowFillPattern.length];
    return row.map((cell) => ({
      text: cell,
      options: {
        fill: { color: fillColor },
      },
    }));
  });

  const rows = [headerRow, ...dataRows];
  const colCount = slideContent.tableData.headers.length;
  const colW =
    referenceStyle.colWidthsInches.length === colCount
      ? referenceStyle.colWidthsInches
      : new Array(colCount).fill(tablePos.w / Math.max(colCount, 1));

  const headerRowH = referenceStyle.rowHeightsInches[0];
  const dataRowPatternHeights = referenceStyle.rowHeightsInches.slice(1);
  const rowH: number[] = [typeof headerRowH === 'number' ? headerRowH : tablePos.h / Math.max(rows.length, 1)];
  for (let i = 0; i < dataRows.length; i += 1) {
    const patternHeight = dataRowPatternHeights[i % Math.max(dataRowPatternHeights.length, 1)];
    rowH.push(typeof patternHeight === 'number' ? patternHeight : tablePos.h / Math.max(rows.length, 1));
  }

  const options: Record<string, unknown> = {
    ...tablePos,
    margin: 0,
    colW,
    rowH,
  };

  const fontFace = resolveFont(bodyElement);
  if (fontFace) {
    options.fontFace = fontFace;
  }

  slide.addTable(rows as never, options as never);
}

function mergePositions(a: Position, b: Position): Position {
  const left = Math.min(a.left_emu, b.left_emu);
  const top = Math.min(a.top_emu, b.top_emu);
  const right = Math.max(a.left_emu + a.width_emu, b.left_emu + b.width_emu);
  const bottom = Math.max(a.top_emu + a.height_emu, b.top_emu + b.height_emu);
  return {
    left_emu: left,
    top_emu: top,
    width_emu: right - left,
    height_emu: bottom - top,
  };
}

function buildImagePlaceholderText(prompts: SlideContent['imagePrompts']): string {
  const prefix = '复制以下内容并在 ITEI Draw 生成PPT配图：';
  if (!prompts?.length) {
    return `${prefix}（请补充页面配图提示词）`;
  }
  if (prompts.length === 1) {
    return `${prefix}${prompts[0].iteiDrawPrompt}`;
  }
  const lines = prompts.map((item, idx) => `${idx + 1}. ${item.iteiDrawPrompt}`);
  return `${prefix}\n${lines.join('\n')}`;
}

function renderImagePromptPlaceholder(
  slide: PptxSlide,
  slideContent: SlideContent,
  def: SlideTypeDefinition,
): void {
  const imagesMode = def.visual_area_modes?.images;
  if (!imagesMode) {
    return;
  }
  const single = imagesMode.single_image_centered?.position;
  const left = imagesMode.two_images_side_by_side?.left_image?.position;
  const right = imagesMode.two_images_side_by_side?.right_image?.position;
  const placeholderPos =
    single ?? (left && right ? mergePositions(left, right) : left ?? right);
  if (!placeholderPos) {
    return;
  }

  const bodyElement = findElement(def, 'body_text');
  const text = buildImagePlaceholderText(slideContent.imagePrompts);
  addTemplateText(slide, {
    text,
    position: placeholderPos,
    element: {
      ...bodyElement,
      alignment: 'left',
      word_wrap: true,
      size_pt: bodyElement?.size_pt ?? 18,
      color: bodyElement?.normal_color ?? bodyElement?.color,
    } as TemplateElement,
  });
}

async function renderImagesInVisualArea(
  slide: PptxSlide,
  slideContent: SlideContent,
  def: SlideTypeDefinition,
  imageFiles: ImageFileMap,
): Promise<void> {
  const imagesMode = def.visual_area_modes?.images;
  if (!imagesMode) {
    return;
  }

  const images = slideContent.images ?? [];
  if (!images.length) {
    renderImagePromptPlaceholder(slide, slideContent, def);
    return;
  }

  if (images.length === 1 && imagesMode.single_image_centered?.position) {
    const data = await resolveImageData(images[0], imageFiles);
    if (!data) {
      renderImagePromptPlaceholder(slide, slideContent, def);
      return;
    }
    const pos = positionToInches(imagesMode.single_image_centered.position);
    slide.addImage({ data, ...pos });
    return;
  }

  const leftPos = imagesMode.two_images_side_by_side?.left_image?.position;
  const rightPos = imagesMode.two_images_side_by_side?.right_image?.position;
  if (!leftPos || !rightPos) {
    throw new Error('template_structure.json.content.images mode missing left/right image positions.');
  }

  const leftData = await resolveImageData(images[0], imageFiles);
  const rightData = await resolveImageData(images[1], imageFiles);
  let added = 0;

  if (leftData) {
    const pos = positionToInches(leftPos);
    slide.addImage({ data: leftData, ...pos });
    added += 1;
  }
  if (rightData) {
    const pos = positionToInches(rightPos);
    slide.addImage({ data: rightData, ...pos });
    added += 1;
  }
  if (added === 0) {
    renderImagePromptPlaceholder(slide, slideContent, def);
  }
}

async function renderContentSlide(
  slide: PptxSlide,
  slideContent: SlideContent,
  def: SlideTypeDefinition,
  imageFiles: ImageFileMap,
): Promise<void> {
  renderContentTextRegions(slide, slideContent, def);

  const mode: VisualMode = slideContent.visualMode ?? 'none';
  if (mode === 'table') {
    renderTableInVisualArea(slide, slideContent, def);
    return;
  }
  if (mode === 'images') {
    await renderImagesInVisualArea(slide, slideContent, def, imageFiles);
  }
}

function renderEndingSlide(slide: PptxSlide, slideContent: SlideContent, def: SlideTypeDefinition): void {
  const textByRole: Record<string, string | undefined> = {
    thanks: slideContent.thanks,
    organization: slideContent.organization,
    contact_info: slideContent.contactInfo?.join('\n'),
  };

  for (const element of def.elements) {
    if (!element.position) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(textByRole, element.role)) {
      const text = textByRole[element.role]?.trim();
      if (!text) {
        continue;
      }
      addTemplateText(slide, { text, position: element.position, element });
      continue;
    }

    const fallbackText = element.description?.trim();
    if (!fallbackText) {
      continue;
    }
    addTemplateText(slide, { text: fallbackText, position: element.position, element });
  }
}

function applyBackgroundByLayout(
  slide: PptxSlide,
  typeDef: SlideTypeDefinition,
  backgrounds: BackgroundAssets,
): void {
  const template = getTemplate();
  const coverLayouts = new Set([
    template.slide_types.cover.layout,
    template.slide_types.ending.layout,
  ]);
  const backgroundData = coverLayouts.has(typeDef.layout) ? backgrounds.coverBg : backgrounds.contentBg;
  slide.background = { data: backgroundData };
}

export async function renderPPTX(
  slides: SlideContent[],
  backgrounds: BackgroundAssets,
  imageFiles: ImageFileMap = new Map(),
): Promise<Blob> {
  const template = getTemplate();
  const pptx = new PptxGenJS();

  pptx.defineLayout({
    name: 'ITEI',
    width: emuToInches(template.presentation.slide_width_emu),
    height: emuToInches(template.presentation.slide_height_emu),
  });
  pptx.layout = 'ITEI';

  for (const slideContent of slides) {
    const slide = pptx.addSlide();
    const typeDef = getSlideType(slideContent.type);
    applyBackgroundByLayout(slide, typeDef, backgrounds);

    if (slideContent.type === 'cover') {
      renderCoverSlide(slide, slideContent, typeDef);
    } else if (slideContent.type === 'toc_section') {
      renderTocSectionSlide(slide, slideContent, typeDef);
    } else if (slideContent.type === 'content') {
      await renderContentSlide(slide, slideContent, typeDef, imageFiles);
    } else if (slideContent.type === 'ending') {
      renderEndingSlide(slide, slideContent, typeDef);
    }
  }

  return (await pptx.write({ outputType: 'blob' })) as Blob;
}
