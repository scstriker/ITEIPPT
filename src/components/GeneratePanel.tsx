import { useEffect, useMemo, useState } from 'react';
import { loadBackgroundAssets } from '../config/assets';
import type { ConfirmRequest } from '../confirm/confirmActions';
import { getImageSlotKey } from '../hooks/useWorkflow';
import { renderPPTX, type ImageFileMap } from '../services/pptxRenderer';
import type { AnalyzerResult, SlideContent } from '@contracts/analyzer';

interface GeneratePanelProps {
  analyzerResult: AnalyzerResult | null;
  importedImages: Map<string, File>;
  requestConfirm: ConfirmRequest;
  confirmBusy: boolean;
  onGenerated: (blob: Blob) => void;
}

async function prepareRenderInput(
  result: AnalyzerResult,
  importedImages: Map<string, File>,
): Promise<{ slides: SlideContent[]; imageFiles: ImageFileMap }> {
  const imageFiles: ImageFileMap = new Map();
  const slides = result.slidePlan.map((slide) => ({ ...slide }));

  for (const slide of slides) {
    if (slide.type !== 'content' || slide.visualMode !== 'images') {
      continue;
    }
    const prompts = slide.imagePrompts ?? [];
    const images: NonNullable<SlideContent['images']> = [];
    for (let slotIndex = 0; slotIndex < prompts.length; slotIndex += 1) {
      const key = getImageSlotKey(slide.page, slotIndex);
      const file = importedImages.get(key);
      if (!file) {
        continue;
      }
      const buffer = await file.arrayBuffer();
      imageFiles.set(key, buffer);
      images.push({
        key,
        mimeType: file.type || 'image/png',
      });
    }
    if (images.length) {
      slide.images = images;
      slide.imageFiles = images.map((img) => img.key ?? '');
    }
  }

  return { slides, imageFiles };
}

export function GeneratePanel({
  analyzerResult,
  importedImages,
  requestConfirm,
  confirmBusy,
  onGenerated,
}: GeneratePanelProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  const stats = useMemo(() => {
    if (!analyzerResult) {
      return null;
    }
    const imageSlideCount = analyzerResult.slidePlan.filter(
      (slide) => slide.type === 'content' && slide.visualMode === 'images',
    ).length;
    return {
      totalSlides: analyzerResult.slidePlan.length,
      imageSlideCount,
    };
  }, [analyzerResult]);

  const preflight = useMemo(() => {
    if (!analyzerResult) {
      return null;
    }

    let imageSlotTotal = 0;
    let importedImageTotal = 0;
    const overLimitPages: number[] = [];

    for (const slide of analyzerResult.slidePlan) {
      if (slide.type !== 'content') {
        continue;
      }

      if ((slide.bodyText ?? '').length > 150) {
        overLimitPages.push(slide.page);
      }

      if (slide.visualMode !== 'images') {
        continue;
      }

      const promptCount = slide.imagePrompts?.length ?? 0;
      imageSlotTotal += promptCount;
      for (let slotIndex = 0; slotIndex < promptCount; slotIndex += 1) {
        if (importedImages.has(getImageSlotKey(slide.page, slotIndex))) {
          importedImageTotal += 1;
        }
      }
    }

    return {
      imageSlotTotal,
      importedImageTotal,
      missingImageTotal: Math.max(0, imageSlotTotal - importedImageTotal),
      overLimitPages,
    };
  }, [analyzerResult, importedImages]);

  const runGeneratePpt = async () => {
    if (!analyzerResult) {
      setErrorMessage('请先完成内容生成后再导出 PPT。');
      return;
    }
    setErrorMessage(null);
    setIsGenerating(true);
    try {
      const backgrounds = await loadBackgroundAssets();
      const { slides, imageFiles } = await prepareRenderInput(analyzerResult, importedImages);
      const blob = await renderPPTX(slides, backgrounds, imageFiles);
      onGenerated(blob);

      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PPT 生成失败';
      setErrorMessage(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGeneratePpt = () => {
    if (!analyzerResult) {
      setErrorMessage('请先完成内容生成后再导出 PPT。');
      return;
    }
    const riskSummaryParts: string[] = [];
    if (preflight?.missingImageTotal) {
      riskSummaryParts.push(`缺少 ${preflight.missingImageTotal} 个图片槽位`);
    }
    if (preflight?.overLimitPages.length) {
      riskSummaryParts.push(`页面 ${preflight.overLimitPages.join(', ')} 正文超 150 字`);
    }
    const riskSummary = riskSummaryParts.length ? riskSummaryParts.join('；') : '当前未发现高风险项。';

    requestConfirm(
      'generate_build_pptx',
      {
        totalSlides: analyzerResult.slidePlan.length,
        riskSummary,
      },
      async () => {
        await runGeneratePpt();
      },
    );
  };

  const outputFilename = 'ITEIPPT_v2_output.pptx';

  const triggerDownload = (url: string, filename: string) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <section className="panel">
      <article className="card">
        <header className="card-header">PPT 导出</header>
        <div className="card-body">
          <p className="panel-hint">将审核后的内容渲染为 PPTX，并提供本地下载。</p>

          <div className="planner-meta">
            <p>
              <strong>总页数：</strong>
              {stats?.totalSlides ?? '-'}
            </p>
            <p>
              <strong>图片页：</strong>
              {stats?.imageSlideCount ?? '-'}
            </p>
          </div>

          {preflight ? (
            <div className="planner-meta">
              <p>
                <strong>图片槽位：</strong>
                {preflight.importedImageTotal}/{preflight.imageSlotTotal}
              </p>
              <p>
                <strong>超字数页面：</strong>
                {preflight.overLimitPages.length ? preflight.overLimitPages.join(', ') : '无'}
              </p>
            </div>
          ) : null}

          {preflight?.missingImageTotal ? (
            <p className="message-warning">
              仍有 {preflight.missingImageTotal} 个图片槽位未导入，导出后将使用占位文本。
            </p>
          ) : null}

          {preflight?.overLimitPages.length ? (
            <p className="message-warning">
              页面 {preflight.overLimitPages.join(', ')} 的正文超过 150 字，可能导致排版拥挤。
            </p>
          ) : null}

          <div className="planner-ai-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleGeneratePpt}
              disabled={isGenerating || confirmBusy || !analyzerResult}
            >
              {isGenerating ? '生成中...' : '生成 PPTX'}
            </button>
            {downloadUrl ? (
              <button
                type="button"
                className="btn btn-success"
                disabled={confirmBusy}
                onClick={() => {
                  requestConfirm(
                    'generate_download_pptx',
                    { fileName: outputFilename },
                    () => triggerDownload(downloadUrl, outputFilename),
                  );
                }}
              >
                下载生成文件
              </button>
            ) : null}
          </div>

          {errorMessage ? <p className="message-error">{errorMessage}</p> : null}
        </div>
      </article>
    </section>
  );
}
