import type { BackgroundAssets } from '../../template/assets';
import { emuToInches, getSlideType, getTemplate } from '../../template/templateLoader';
import type { SlideTypeDefinition } from '@contracts/template';
import type { SlideContent } from '@contracts/analyzer';
import { renderContentSlide } from './contentSlide';
import { renderCoverSlide } from './coverSlide';
import { renderEndingSlide } from './endingSlide';
import { renderTocSectionSlide } from './tocSlide';
import { PptxGenJS } from './types';
import type { ImageFileMap, PptxSlide } from './types';

export type { SlideContent } from '@contracts/analyzer';
export type { ImageFileMap } from './types';

export function applyBackgroundByLayout(
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
