import type { SlideImageData } from '@contracts/analyzer';
import type { ImageFileMap } from './types';

export function toPptxDataUrl(input: string, mimeType = 'image/jpeg'): string {
  const trimmed = input.replace(/^\uFEFF/, '').replace(/\s+/g, '').trim();
  if (trimmed.startsWith('image/')) {
    return trimmed;
  }
  if (trimmed.startsWith('data:image/')) {
    return trimmed.replace(/^data:/, '');
  }
  return `${mimeType};base64,${trimmed}`;
}

export function arrayBufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export async function resolveImageData(image: SlideImageData | undefined, imageFiles: ImageFileMap): Promise<string | undefined> {
  if (!image) {
    return undefined;
  }
  if (image.data) {
    return toPptxDataUrl(image.data, image.mimeType ?? 'image/jpeg');
  }
  if (!image.key || !imageFiles.has(image.key)) {
    return undefined;
  }
  const source = imageFiles.get(image.key);
  if (!source) {
    return undefined;
  }
  if (typeof source === 'string') {
    return toPptxDataUrl(source, image.mimeType ?? 'image/jpeg');
  }
  if (source instanceof Blob) {
    const buffer = await source.arrayBuffer();
    return `${image.mimeType ?? 'image/jpeg'};base64,${arrayBufferToBase64(buffer)}`;
  }
  if (source instanceof Uint8Array) {
    return `${image.mimeType ?? 'image/jpeg'};base64,${arrayBufferToBase64(source.buffer as ArrayBuffer)}`;
  }
  return `${image.mimeType ?? 'image/jpeg'};base64,${arrayBufferToBase64(source)}`;
}
