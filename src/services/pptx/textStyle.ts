import { positionToInches } from '../../template/templateLoader';
import type { SlideTypeDefinition, TemplateElement, TemplateParagraph, TemplateShape } from '@contracts/template';
import type { PptxSlide, TextPlacement } from './types';

export const SCHEME_COLOR_MAP: Record<string, string> = {
  'scheme:bg1': 'FFFFFF',
  'scheme:tx1': '000000',
};

export function normalizeColor(raw?: string): string | undefined {
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

export function normalizeAlign(raw?: string): 'left' | 'center' | 'right' | 'justify' | 'dist' | undefined {
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

export function resolveFont(element?: TemplateElement): string | undefined {
  if (!element) {
    return undefined;
  }
  return element.font_chinese ?? element.font ?? element.font_latin;
}

export function findElement(def: SlideTypeDefinition, role: string): TemplateElement | undefined {
  return def.elements.find((item) => item.role === role);
}

export function getFirstParagraph(shape: TemplateShape): TemplateParagraph | undefined {
  const paragraph = shape.text_frame?.paragraphs?.[0];
  if (!paragraph || typeof paragraph === 'string') {
    return undefined;
  }
  return paragraph;
}

export function applyParagraphStyle(options: Record<string, unknown>, paragraph: TemplateParagraph | undefined): void {
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

export function applyElementTextStyle(options: Record<string, unknown>, element: TemplateElement | undefined): void {
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

export function addTemplateText(slide: PptxSlide, placement: TextPlacement): void {
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
