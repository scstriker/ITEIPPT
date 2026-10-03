import { useEffect, useMemo, useState } from 'react';
import { IconDownload, IconPresentation } from '@tabler/icons-react';
import { Card, Notice } from '@/components/itei/Blocks';
import { Button } from '@/components/ui/button';
import type { AnalyzerResult } from '@contracts/analyzer';
import type { ConfirmRequest } from '../../confirm/confirmActions';
import { renderPPTX } from '../../services/pptx/renderPptx';
import { loadBackgroundAssets } from '../../template/assets';
import {
  OUTPUT_FILENAME,
  buildRiskSummary,
  computeExportStats,
  computePreflight,
  prepareRenderInput,
} from './exportPreflight';

interface GeneratePanelProps {
  analyzerResult: AnalyzerResult | null;
  importedImages: Map<string, File>;
  requestConfirm: ConfirmRequest;
  confirmBusy: boolean;
  onGenerated: (blob: Blob) => void;
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

  const stats = useMemo(() => (analyzerResult ? computeExportStats(analyzerResult) : null), [analyzerResult]);

  const preflight = useMemo(
    () => (analyzerResult ? computePreflight(analyzerResult, importedImages) : null),
    [analyzerResult, importedImages],
  );

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
    const riskSummary = preflight ? buildRiskSummary(preflight) : '当前未发现高风险项。';

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

  const outputFilename = OUTPUT_FILENAME;

  const triggerDownload = (url: string, filename: string) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <Card title="PPT 导出" bodyClassName="flex flex-col gap-4">
      <p className="text-[13px] leading-5 text-ink-muted">将审核后的内容渲染为 PPTX，并提供本地下载。</p>

      <div className="grid gap-3 border border-border bg-surface-sunken p-3 text-[13px] leading-5 text-ink sm:grid-cols-2">
        <p>
          <strong className="text-brand-navy">总页数：</strong>
          {stats?.totalSlides ?? '-'}
        </p>
        <p>
          <strong className="text-brand-navy">图片页：</strong>
          {stats?.imageSlideCount ?? '-'}
        </p>
        {preflight ? (
          <>
            <p>
              <strong className="text-brand-navy">图片槽位：</strong>
              {preflight.importedImageTotal}/{preflight.imageSlotTotal}
            </p>
            <p>
              <strong className="text-brand-navy">超字数页面：</strong>
              {preflight.overLimitPages.length ? preflight.overLimitPages.join(', ') : '无'}
            </p>
          </>
        ) : null}
      </div>

      {preflight?.missingImageTotal ? (
        <Notice tone="warning">仍有 {preflight.missingImageTotal} 个图片槽位未导入，导出后将使用占位文本。</Notice>
      ) : null}

      {preflight?.overLimitPages.length ? (
        <Notice tone="warning">页面 {preflight.overLimitPages.join(', ')} 的正文超过 150 字，可能导致排版拥挤。</Notice>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={handleGeneratePpt} disabled={isGenerating || confirmBusy || !analyzerResult}>
          <IconPresentation aria-hidden="true" stroke={2} />
          {isGenerating ? '生成中...' : '生成 PPTX'}
        </Button>
        {downloadUrl ? (
          <Button
            type="button"
            variant="outline"
            disabled={confirmBusy}
            onClick={() => {
              requestConfirm('generate_download_pptx', { fileName: outputFilename }, () =>
                triggerDownload(downloadUrl, outputFilename),
              );
            }}
          >
            <IconDownload aria-hidden="true" stroke={2} />
            下载生成文件
          </Button>
        ) : null}
      </div>

      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
    </Card>
  );
}
