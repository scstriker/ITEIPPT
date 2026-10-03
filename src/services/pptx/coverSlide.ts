import type { SlideTypeDefinition } from '@contracts/template';
import type { SlideContent } from '@contracts/analyzer';
import { buildCoverStandardNameRuns, resolveCoverTitleLineSpacing, stripBookTitleMarkers } from './textLayout';
import { addTemplateText } from './textStyle';
import type { PptxSlide } from './types';

export function renderCoverSlide(slide: PptxSlide, slideContent: SlideContent, def: SlideTypeDefinition): void {
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
