import { positionToInches } from '../../template/templateLoader';
import type { SlideTypeDefinition, TemplateElement, VisualMode } from '@contracts/template';
import type { SlideContent } from '@contracts/analyzer';
import { mergePositions } from './geometry';
import { resolveImageData } from './images';
import { getContentTableReferenceStyleStrict } from './templateRefs';
import { buildAdaptiveSubtitleLayout, buildBodyRuns } from './textLayout';
import { addTemplateText, findElement, normalizeColor, resolveFont } from './textStyle';
import type { ImageFileMap, PptxSlide } from './types';

export function renderContentTextRegions(slide: PptxSlide, slideContent: SlideContent, def: SlideTypeDefinition): void {
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

export function renderTableInVisualArea(slide: PptxSlide, slideContent: SlideContent, def: SlideTypeDefinition): void {
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

export function buildImagePlaceholderText(prompts: SlideContent['imagePrompts']): string {
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

export function renderImagePromptPlaceholder(
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

export async function renderImagesInVisualArea(
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

export async function renderContentSlide(
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
