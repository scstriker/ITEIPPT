import { getTemplate, positionToInches } from '../../template/templateLoader';
import type { SlideTypeDefinition } from '@contracts/template';
import type { SlideContent } from '@contracts/analyzer';
import { getTocRowLayoutsStrict } from './templateRefs';
import { addTemplateText, findElement, normalizeColor } from './textStyle';
import type { PptxSlide } from './types';

export function renderTocSectionSlide(slide: PptxSlide, slideContent: SlideContent, def: SlideTypeDefinition): void {
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
