import coverBase64Raw from './bg-cover.base64?raw';
import contentBase64Raw from './bg-content.base64?raw';

export interface BackgroundAssets {
  coverBg: string;
  contentBg: string;
}

let cachedAssets: BackgroundAssets | null = null;

function normalizeBase64(input: string): string {
  return input.replace(/^\uFEFF/, '').replace(/\s+/g, '').trim();
}

function toPptxDataUrl(base64Body: string, mimeType = 'image/jpeg'): string {
  if (base64Body.startsWith('image/')) {
    return base64Body;
  }
  if (base64Body.startsWith('data:image/')) {
    return base64Body.replace(/^data:/, '');
  }
  return `${mimeType};base64,${base64Body}`;
}

export async function loadBackgroundAssets(): Promise<BackgroundAssets> {
  if (cachedAssets) {
    return cachedAssets;
  }

  const coverBase64 = normalizeBase64(coverBase64Raw);
  const contentBase64 = normalizeBase64(contentBase64Raw);

  cachedAssets = {
    coverBg: toPptxDataUrl(coverBase64),
    contentBg: toPptxDataUrl(contentBase64),
  };

  return cachedAssets;
}
