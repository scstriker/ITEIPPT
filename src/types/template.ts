export type SlideType = 'cover' | 'toc_section' | 'content' | 'ending';
export type VisualMode = 'none' | 'table' | 'images';

export interface Position {
  left_emu: number;
  top_emu: number;
  width_emu: number;
  height_emu: number;
  left_cm?: number;
  top_cm?: number;
  width_cm?: number;
  height_cm?: number;
  [key: string]: unknown;
}

export interface TemplateTextRun {
  text?: string;
  font_name?: string;
  latin_font?: string;
  font_size_pt?: number;
  font_color?: string;
  bold?: boolean;
  [key: string]: unknown;
}

export interface TemplateParagraph {
  runs?: Array<TemplateTextRun | string>;
  alignment?: string;
  line_spacing_pct?: number;
  line_spacing_pt?: number;
  space_before_pt?: number;
  space_after_pt?: number;
  text?: string;
  [key: string]: unknown;
}

export interface TemplateTextFrame {
  paragraphs?: Array<TemplateParagraph | string>;
  word_wrap?: boolean;
  text?: string;
  [key: string]: unknown;
}

export interface TemplateTableCell {
  text?: string;
  paragraphs?: Array<TemplateParagraph | string>;
  fill_color?: string;
  [key: string]: unknown;
}

export interface TemplateTableDefinition {
  rows?: TemplateTableCell[][];
  col_widths_cm?: number[];
  row_heights_cm?: number[];
  row_count?: number;
  col_count?: number;
  [key: string]: unknown;
}

export interface TemplateShape {
  shape_id?: number;
  name?: string;
  position?: Position;
  shape_type?: string;
  children?: TemplateShape[];
  text_frame?: TemplateTextFrame;
  table?: TemplateTableDefinition;
  fill?: string;
  fill_color?: string;
  image_rId?: string;
  placeholder_idx?: number | string;
  placeholder_type?: string;
  rotation?: number;
  auto_shape_type?: string;
  [key: string]: unknown;
}

export interface TemplateElementField {
  name?: string;
  description?: string;
  position?: Position;
  font?: string;
  size_pt?: number;
  bold?: boolean;
  color?: string;
  fill_color?: string;
  alignment?: string;
  [key: string]: unknown;
}

export interface TemplateElementItem {
  number?: string;
  title?: string;
  text?: string;
  position?: Position;
  number_size_pt?: number;
  title_size_pt?: number;
  normal_color?: string;
  highlight_color?: string;
  [key: string]: unknown;
}

export interface TemplateElement {
  role: string;
  description?: string;
  position?: Position;
  font?: string;
  font_latin?: string;
  font_chinese?: string;
  size_pt?: number;
  bracket_size_pt?: number;
  number_size_pt?: number;
  title_size_pt?: number;
  bold?: boolean;
  color?: string;
  fill?: string | Record<string, unknown>;
  fill_color?: string;
  alignment?: string;
  line_spacing_pct?: number;
  line_spacing_pt?: number;
  space_before_pt?: number;
  space_after_pt?: number;
  word_wrap?: boolean;
  normal_color?: string;
  highlight_color?: string;
  note?: string;
  fields?: Array<TemplateElementField | string>;
  items?: TemplateElementItem[];
  [key: string]: unknown;
}

export interface LayoutZoneDefinition {
  description?: string;
  position: Position;
  note?: string;
  [key: string]: unknown;
}

export interface VisualAreaModeDefinition {
  description?: string;
  default_position?: Position;
  header_row?: Record<string, unknown>;
  data_rows?: Record<string, unknown>;
  two_images_side_by_side?: {
    left_image?: { position?: Position; [key: string]: unknown };
    right_image?: { position?: Position; [key: string]: unknown };
    [key: string]: unknown;
  };
  single_image_centered?: {
    position?: Position;
    note?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SlideTypeDefinition {
  description: string;
  layout: string;
  structure?: string;
  example_slide?: number;
  example_slides?: number[];
  elements: TemplateElement[];
  layout_zones?: Record<string, LayoutZoneDefinition>;
  visual_area_modes?: Record<string, VisualAreaModeDefinition>;
  [key: string]: unknown;
}

export interface PresentationLayout {
  index: number;
  description: string;
  [key: string]: unknown;
}

export interface PresentationDefinition {
  slide_width_cm?: number;
  slide_height_cm?: number;
  slide_width_emu: number;
  slide_height_emu: number;
  total_slides: number;
  layouts: Record<string, PresentationLayout>;
  theme_colors: Record<string, string>;
  fonts: Record<string, string>;
  [key: string]: unknown;
}

export interface SlideInstance {
  slide_number: number;
  slide_type: SlideType;
  visual_mode?: VisualMode;
  layout_name: string;
  shapes?: TemplateShape[];
  [key: string]: unknown;
}

export interface TemplateStructure {
  presentation: PresentationDefinition;
  slide_types: Record<string, SlideTypeDefinition> & {
    cover: SlideTypeDefinition;
    toc_section: SlideTypeDefinition;
    content: SlideTypeDefinition;
    ending: SlideTypeDefinition;
  };
  slides: SlideInstance[];
}

export interface PptxPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}
