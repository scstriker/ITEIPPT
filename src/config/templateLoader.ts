import templateJson from '../../docs/template_structure.json';
import type {
  Position,
  PptxPosition,
  SlideInstance,
  SlideTypeDefinition,
  TemplateShape,
  TemplateStructure,
} from '@contracts/template';

const EMU_PER_INCH = 914400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertTemplateStructure(value: unknown): asserts value is TemplateStructure {
  if (!isRecord(value)) {
    throw new Error('template_structure.json must be an object.');
  }

  if (!isRecord(value.presentation)) {
    throw new Error('template_structure.json.presentation is missing or invalid.');
  }

  if (!isRecord(value.slide_types)) {
    throw new Error('template_structure.json.slide_types is missing or invalid.');
  }

  const requiredSlideTypes = ['cover', 'toc_section', 'content', 'ending'];
  for (const slideType of requiredSlideTypes) {
    if (!isRecord(value.slide_types[slideType])) {
      throw new Error(`template_structure.json.slide_types.${slideType} is missing.`);
    }
  }

  if (!Array.isArray(value.slides)) {
    throw new Error('template_structure.json.slides must be an array.');
  }

  for (const [name, slideType] of Object.entries(value.slide_types)) {
    if (!isRecord(slideType)) {
      throw new Error(`template_structure.json.slide_types.${name} must be an object.`);
    }
    if (!Array.isArray(slideType.elements)) {
      throw new Error(`template_structure.json.slide_types.${name}.elements must be an array.`);
    }
  }
}

function isPosition(value: unknown): value is Position {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.left_emu === 'number' &&
    typeof value.top_emu === 'number' &&
    typeof value.width_emu === 'number' &&
    typeof value.height_emu === 'number'
  );
}

function hasChapterTitleText(shape: TemplateShape): boolean {
  return (shape.children ?? []).some((child) => {
    const text = child.text_frame?.text;
    return typeof text === 'string' && /[一二三四五六七八九十]\s*、/.test(text);
  });
}

function flattenShapes(shapes: TemplateShape[] | undefined): TemplateShape[] {
  if (!shapes?.length) {
    return [];
  }
  const result: TemplateShape[] = [];
  const walk = (items: TemplateShape[]): void => {
    for (const item of items) {
      result.push(item);
      if (item.children?.length) {
        walk(item.children);
      }
    }
  };
  walk(shapes);
  return result;
}

function assertPhase1TemplateIntegrity(template: TemplateStructure): void {
  if (
    typeof template.presentation.slide_width_emu !== 'number' ||
    typeof template.presentation.slide_height_emu !== 'number'
  ) {
    throw new Error('template_structure.json.presentation slide dimensions are invalid.');
  }

  const coverElements = template.slide_types.cover.elements;
  const standardName = coverElements.find((item) => item.role === 'standard_name');
  const mainTitle = coverElements.find((item) => item.role === 'main_title');
  if (!standardName || !mainTitle || !isPosition(standardName.position) || !isPosition(mainTitle.position)) {
    throw new Error('template_structure.json.cover missing required elements (standard_name/main_title).');
  }

  const tocElements = template.slide_types.toc_section.elements;
  const pageTitle = tocElements.find((item) => item.role === 'page_title');
  const sectionItems = tocElements.find((item) => item.role === 'section_items');
  if (!pageTitle || !isPosition(pageTitle.position) || !sectionItems?.items?.length) {
    throw new Error('template_structure.json.toc_section missing page_title/section_items.');
  }

  const tocSlide = template.slides.find((slide) => slide.slide_type === 'toc_section' && slide.shapes?.length);
  if (!tocSlide?.shapes?.length) {
    throw new Error('template_structure.json.slides missing toc_section reference slide with shapes.');
  }
  const tocGroups = tocSlide.shapes.filter((shape) => shape.shape_type === 'group' && hasChapterTitleText(shape));
  if (!tocGroups.length) {
    throw new Error('template_structure.json.toc_section reference missing chapter group geometry.');
  }

  const content = template.slide_types.content;
  const topBar = content.layout_zones?.top_bar?.position;
  const subTitleArea = content.layout_zones?.sub_title_area?.position;
  const textArea = content.layout_zones?.text_content_area?.position;
  if (!isPosition(topBar) || !isPosition(subTitleArea) || !isPosition(textArea)) {
    throw new Error('template_structure.json.content.layout_zones missing top_bar/sub_title_area/text_content_area.');
  }

  const subTitle = content.elements.find((item) => item.role === 'sub_title');
  const bodyText = content.elements.find((item) => item.role === 'body_text');
  if (!subTitle || typeof subTitle.fill_color !== 'string') {
    throw new Error('template_structure.json.content.sub_title.fill_color is required.');
  }
  if (!bodyText || typeof bodyText.normal_color !== 'string' || typeof bodyText.highlight_color !== 'string') {
    throw new Error('template_structure.json.content.body_text normal/highlight colors are required.');
  }

  const contentSlides = template.slides.filter((slide) => slide.slide_type === 'content' && slide.shapes?.length);
  const contentShapes = contentSlides.flatMap((slide) => flattenShapes(slide.shapes));
  const tableShape = contentShapes.find((shape) => shape.shape_type === 'table' && shape.table?.rows?.length);
  if (!tableShape) {
    throw new Error('template_structure.json.content reference table shape is required.');
  }

  const endingElements = template.slide_types.ending.elements;
  const contactInfo = endingElements.find((item) => item.role === 'contact_info');
  if (!contactInfo || typeof contactInfo.line_spacing_pct !== 'number') {
    throw new Error('template_structure.json.ending.contact_info.line_spacing_pct is required.');
  }
}

const templateData: unknown = templateJson;
assertTemplateStructure(templateData);
const templateStructure: TemplateStructure = templateData;
assertPhase1TemplateIntegrity(templateStructure);

// EMU -> inches conversion used by PptxGenJS.
export const emuToInches = (emu: number): number => emu / EMU_PER_INCH;

// Convert template EMU position to PptxGenJS coordinates.
export function positionToInches(pos: Position): PptxPosition {
  return {
    x: emuToInches(pos.left_emu),
    y: emuToInches(pos.top_emu),
    w: emuToInches(pos.width_emu),
    h: emuToInches(pos.height_emu),
  };
}

export function getTemplate(): TemplateStructure {
  return templateStructure;
}

export function getSlideType(type: string): SlideTypeDefinition {
  const slideType = templateStructure.slide_types[type];
  if (!slideType) {
    throw new Error(`Unknown slide type: ${type}`);
  }
  return slideType;
}

export function getReferenceSlides(type: string): SlideInstance[] {
  return templateStructure.slides.filter((slide) => slide.slide_type === type);
}

export function getReferenceSlide(
  type: string,
  predicate?: (slide: SlideInstance) => boolean,
): SlideInstance {
  const candidates = getReferenceSlides(type);
  const match = predicate ? candidates.find(predicate) : candidates.find((slide) => !!slide.shapes?.length);
  if (!match) {
    throw new Error(`No reference slide found for type "${type}".`);
  }
  return match;
}
