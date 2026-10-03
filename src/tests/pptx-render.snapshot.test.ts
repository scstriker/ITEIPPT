// AC-024: the PPTX renderer output stays identical through the refactor.
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { loadBackgroundAssets } from '../config/assets';
import { renderPPTX, type ImageFileMap } from '../services/pptxRenderer';
import { pngBytes, renderFixtureSlides } from './fixtures/slides';

async function renderFixture(): Promise<JSZip> {
  const imageFiles: ImageFileMap = new Map();
  for (const key of ['page-4-slot-0', 'page-4-slot-1', 'page-5-slot-0']) {
    imageFiles.set(key, pngBytes().buffer as ArrayBuffer);
  }
  const blob = await renderPPTX(renderFixtureSlides(), await loadBackgroundAssets(), imageFiles);
  return JSZip.loadAsync(await blob.arrayBuffer());
}

function slideNames(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
}

describe('renderPPTX', () => {
  it('renders one slide per SlideContent', async () => {
    const zip = await renderFixture();
    expect(slideNames(zip)).toHaveLength(9);
  });

  it('is deterministic', async () => {
    const [a, b] = await Promise.all([renderFixture(), renderFixture()]);
    for (const name of slideNames(a)) {
      expect(await a.file(name)!.async('string')).toBe(await b.file(name)!.async('string'));
    }
  });

  it('matches the slide XML snapshots', async () => {
    const zip = await renderFixture();
    for (const name of slideNames(zip)) {
      const xml = await zip.file(name)!.async('string');
      const rels = await zip.file(name.replace('slides/', 'slides/_rels/') + '.rels')?.async('string');
      expect({ xml, rels }).toMatchSnapshot(name);
    }
  });

  it('writes the image placeholder text when no image is imported', async () => {
    const zip = await renderFixture();
    const single = await zip.file('ppt/slides/slide6.xml')!.async('string');
    expect(single).toContain('复制以下内容并在 ITEI Draw 生成PPT配图：standard drafting timeline');
    const double = await zip.file('ppt/slides/slide7.xml')!.async('string');
    expect(double).toContain('1. expert meeting');
    expect(double).toContain('2. conclusion board');
  });
});
