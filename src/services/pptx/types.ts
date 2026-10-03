import PptxGenJSImport from 'pptxgenjs';
import type { Position, TemplateElement, TemplateParagraph, TemplateShape } from '@contracts/template';

export type PptxGenJSConstructor = typeof PptxGenJSImport;

export const PptxGenJS: PptxGenJSConstructor =
  (PptxGenJSImport as unknown as { default?: PptxGenJSConstructor }).default ?? PptxGenJSImport;

export type PptxSlide = ReturnType<InstanceType<PptxGenJSConstructor>['addSlide']>;

export type PptxTextRun = { text: string; options?: Record<string, unknown> };

export type ImageFileMap = Map<string, ArrayBuffer | Uint8Array | Blob | string>;

export interface TextPlacement {
  text: string | PptxTextRun[];
  position: Position;
  element?: TemplateElement;
  paragraphStyle?: TemplateParagraph;
  colorOverride?: string;
  rotation?: number;
}

export interface PositionBounds {
  minLeft: number;
  minTop: number;
  width: number;
  height: number;
}

export interface TocShapeNode {
  shape: TemplateShape;
  position: Position;
}

export interface TocRunStyle {
  paragraph?: TemplateParagraph;
}

export interface TocRowLayout {
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

export interface TableReferenceStyle {
  colWidthsInches: number[];
  rowHeightsInches: number[];
  headerFillColor: string;
  headerFontColor: string;
  dataRowFillPattern: string[];
}
