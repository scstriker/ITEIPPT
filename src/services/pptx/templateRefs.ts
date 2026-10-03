import { getReferenceSlide } from '../../template/templateLoader';
import type { Position, TemplateShape } from '@contracts/template';
import { cmToInches, getShapeFillColor, getShapeText, resolveGroupChildrenAbs } from './geometry';
import { getFirstParagraph, normalizeColor } from './textStyle';
import type { TableReferenceStyle, TocRowLayout, TocShapeNode } from './types';

export function expectTocNode(node: TocShapeNode | undefined, message: string): TocShapeNode {
  if (!node) {
    throw new Error(`template_structure.json.toc_section invalid: ${message}`);
  }
  return node;
}

export function getTocRowLayoutsStrict(): TocRowLayout[] {
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

export function getContentTableReferenceStyleStrict(): TableReferenceStyle {
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
