import type { Position, TemplateShape } from '@contracts/template';
import { normalizeColor } from './textStyle';
import type { PositionBounds } from './types';

export const EMU_PER_INCH = 914400;

export const PT_TO_EMU = 12700;

export function cmToInches(value: number): number {
  return value / 2.54;
}

export function getPositionBounds(shapes: TemplateShape[]): PositionBounds | null {
  const withPosition = shapes.filter((item) => !!item.position) as Array<TemplateShape & { position: Position }>;
  if (!withPosition.length) {
    return null;
  }
  let minLeft = Number.POSITIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;
  for (const shape of withPosition) {
    minLeft = Math.min(minLeft, shape.position.left_emu);
    minTop = Math.min(minTop, shape.position.top_emu);
    maxRight = Math.max(maxRight, shape.position.left_emu + shape.position.width_emu);
    maxBottom = Math.max(maxBottom, shape.position.top_emu + shape.position.height_emu);
  }
  return {
    minLeft,
    minTop,
    width: Math.max(1, maxRight - minLeft),
    height: Math.max(1, maxBottom - minTop),
  };
}

export function transformChildPosition(parent: Position, child: Position, bounds: PositionBounds): Position {
  const relLeft = (child.left_emu - bounds.minLeft) / bounds.width;
  const relTop = (child.top_emu - bounds.minTop) / bounds.height;
  const relWidth = child.width_emu / bounds.width;
  const relHeight = child.height_emu / bounds.height;
  return {
    left_emu: parent.left_emu + parent.width_emu * relLeft,
    top_emu: parent.top_emu + parent.height_emu * relTop,
    width_emu: parent.width_emu * relWidth,
    height_emu: parent.height_emu * relHeight,
  };
}

export function resolveGroupChildrenAbs(
  parentPosition: Position,
  children: TemplateShape[] | undefined,
): Array<{ shape: TemplateShape; position: Position }> {
  if (!children?.length) {
    return [];
  }
  const bounds = getPositionBounds(children);
  if (!bounds) {
    return [];
  }
  return children
    .filter((child) => !!child.position)
    .map((child) => ({
      shape: child,
      position: transformChildPosition(parentPosition, child.position as Position, bounds),
    }));
}

export function getShapeText(shape: TemplateShape): string {
  return typeof shape.text_frame?.text === 'string' ? shape.text_frame.text : '';
}

export function getShapeFillColor(shape: TemplateShape): string | undefined {
  return normalizeColor(
    typeof shape.fill_color === 'string'
      ? shape.fill_color
      : typeof shape.fill === 'string'
        ? shape.fill
        : undefined,
  );
}

export function mergePositions(a: Position, b: Position): Position {
  const left = Math.min(a.left_emu, b.left_emu);
  const top = Math.min(a.top_emu, b.top_emu);
  const right = Math.max(a.left_emu + a.width_emu, b.left_emu + b.width_emu);
  const bottom = Math.max(a.top_emu + a.height_emu, b.top_emu + b.height_emu);
  return {
    left_emu: left,
    top_emu: top,
    width_emu: right - left,
    height_emu: bottom - top,
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
