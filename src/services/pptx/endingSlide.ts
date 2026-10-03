import type { SlideTypeDefinition } from '@contracts/template';
import type { SlideContent } from '@contracts/analyzer';
import { addTemplateText } from './textStyle';
import type { PptxSlide } from './types';

export function renderEndingSlide(slide: PptxSlide, slideContent: SlideContent, def: SlideTypeDefinition): void {
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
