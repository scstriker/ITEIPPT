import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconBrush,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconPhotoUp,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import { Card, Notice } from '@/components/itei/Blocks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ConfirmRequest } from '../../confirm/confirmActions';
import type { AnalyzerResult } from '@contracts/analyzer';
import {
  bulkImportMessage,
  getImageSlotKey,
  getSlidePrompts,
  listImageSlides,
  listImageSlots,
  planBulkImport,
  validateImageFile,
} from './imageSlots';

interface ImageImporterProps {
  analyzerResult: AnalyzerResult | null;
  importedImages: Map<string, File>;
  requestConfirm: ConfirmRequest;
  confirmBusy: boolean;
  onImportImage: (slotKey: string, file: File) => void;
  onRemoveImage: (slotKey: string) => void;
}

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  return url;
}

function ImagePreview({ file, alt }: { file: File | null; alt: string }) {
  const previewUrl = useObjectUrl(file);

  if (!previewUrl) {
    return <div className="text-[13px] leading-5 text-ink-muted">未上传图片</div>;
  }

  return <img src={previewUrl} alt={alt} className="max-h-56 w-full object-contain" />;
}

export function ImageImporter({
  analyzerResult,
  importedImages,
  requestConfirm,
  confirmBusy,
  onImportImage,
  onRemoveImage,
}: ImageImporterProps) {
  const imageSlides = useMemo(() => listImageSlides(analyzerResult), [analyzerResult]);
  const [expandedPage, setExpandedPage] = useState<number | null>(null);
  const bulkInputRef = useRef<HTMLInputElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const allSlots = useMemo(() => listImageSlots(imageSlides), [imageSlides]);

  const importedSlotCount = useMemo(() => allSlots.filter((slot) => importedImages.has(slot.key)).length, [allSlots, importedImages]);
  const missingSlotCount = allSlots.length - importedSlotCount;

  useEffect(() => {
    if (!imageSlides.length) {
      setExpandedPage(null);
      return;
    }
    setExpandedPage((prev) => {
      if (prev !== null && imageSlides.some((slide) => slide.page === prev)) {
        return prev;
      }
      return imageSlides[0].page;
    });
  }, [imageSlides]);

  const handleImageUpload = (
    page: number,
    slotIndex: number,
    slotKey: string,
    isReplacing: boolean,
    selected: File | undefined,
  ) => {
    if (!selected) {
      return;
    }
    const validationError = validateImageFile(selected);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    requestConfirm(
      isReplacing ? 'image_replace' : 'image_upload',
      {
        page,
        slotIndex,
        fileName: selected.name,
      },
      () => {
        setErrorMessage(null);
        setInfoMessage(`已更新图片：${selected.name}`);
        onImportImage(slotKey, selected);
      },
    );
  };

  const drawLinkButton = (
    <a
      className="fixed top-[calc(50%-20px)] right-6 z-40 inline-flex h-10 items-center gap-1.5 rounded-sm bg-brand-navy px-5 text-[15px] leading-5 font-semibold text-on-brand shadow-raised transition-colors duration-150 ease-out hover:bg-brand-navy-deep"
      href="https://draw.sensor-cloud.org/"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="打开 ITEI DRAW"
    >
      <IconBrush aria-hidden="true" className="size-[18px]" stroke={2} />
      ITEI DRAW
      <IconExternalLink aria-hidden="true" className="size-4" stroke={2} />
    </a>
  );

  if (!imageSlides.length) {
    return (
      <>
        <Card title="Step 3 · 配图导入">
          <p className="text-[13px] leading-5 text-ink-muted">当前内容中没有需要图片的页面，可直接进入审计预览。</p>
        </Card>
        {drawLinkButton}
      </>
    );
  }

  return (
    <>
      <Card title="Step 3 · 配图导入" bodyClassName="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4 border border-border bg-surface-sunken p-3">
          <div className="flex flex-1 flex-col gap-1 text-[13px] leading-5 text-ink">
            <p>
              导入方式 1：复制“图片描述”到 ITEI Draw 生成图片后上传到对应槽位；
              导入方式 2：直接上传你自己的本地图片（可替换）。
            </p>
            <p className="text-ink-muted">
              当前进度：已导入 {importedSlotCount}/{allSlots.length}，待导入 {missingSlotCount}。
            </p>
          </div>
          <label
            htmlFor="bulk-import-input"
            className={cn(
              'inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-sm bg-brand-navy px-5 text-[15px] leading-5 font-semibold text-on-brand transition-colors duration-150 ease-out hover:bg-brand-navy-deep',
              confirmBusy && 'pointer-events-none bg-surface-sunken text-ink-disabled',
            )}
          >
            <IconPhotoUp aria-hidden="true" className="size-[18px]" stroke={2} />
            批量导入图片
          </label>
          <input
            id="bulk-import-input"
            ref={bulkInputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={confirmBusy}
            className="sr-only"
            onChange={(event) => {
              const files = event.target.files ? Array.from(event.target.files) : [];
              event.target.value = '';
              if (!files.length) {
                return;
              }

              const validated: File[] = [];
              for (const file of files) {
                const validationError = validateImageFile(file);
                if (validationError) {
                  setErrorMessage(validationError);
                  return;
                }
                validated.push(file);
              }

              const plan = planBulkImport(allSlots, importedImages, validated.length);
              if (plan.targetKeys.length <= 0) {
                setInfoMessage('当前没有可填充的空槽位，未执行批量导入。');
                return;
              }

              requestConfirm(
                'image_bulk_import',
                {
                  fileCount: validated.length,
                  availableSlots: plan.availableSlots,
                },
                () => {
                  plan.targetKeys.forEach((key, index) => {
                    onImportImage(key, validated[index]);
                  });
                  setErrorMessage(null);
                  setInfoMessage(bulkImportMessage(plan));
                },
              );
            }}
          />
        </div>

        {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
        {infoMessage ? <Notice tone="info">{infoMessage}</Notice> : null}

        <div className="flex flex-col gap-3">
          {imageSlides.map((slide) => {
            const prompts = getSlidePrompts(slide);
            const isExpanded = expandedPage === slide.page;

            return (
              <article key={slide.page} className="border border-border bg-surface-raised">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-out hover:bg-info-bg"
                  onClick={() => setExpandedPage((prev) => (prev === slide.page ? null : slide.page))}
                  aria-expanded={isExpanded}
                >
                  <IconChevronRight
                    aria-hidden="true"
                    className={cn('size-4 text-brand-navy transition-transform duration-150 ease-out', isExpanded && 'rotate-90')}
                    stroke={2}
                  />
                  <span className="flex-1 text-base leading-6 font-bold text-brand-navy">
                    第 {slide.page} 页 · {slide.subtitle ?? slide.chapterTitle}
                  </span>
                  <Badge variant="neutral">{prompts.length}</Badge>
                </button>

                {isExpanded ? (
                  <div className="flex flex-col gap-4 border-t border-border p-4">
                    {prompts.map((prompt, slotIndex) => {
                      const slotKey = getImageSlotKey(slide.page, slotIndex);
                      const file = importedImages.get(slotKey) ?? null;

                      return (
                        <div key={slotKey} className="flex flex-col gap-3">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[13px] leading-4 font-semibold text-ink">图片 {slotIndex + 1} 描述</span>
                              <Textarea readOnly value={prompt.iteiDrawPrompt} className="min-h-40 font-mono text-[13px]" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[13px] leading-4 font-semibold text-ink">预览</span>
                              <div className="flex min-h-40 items-center justify-center border border-border bg-surface-sunken">
                                <ImagePreview file={file} alt={`第${slide.page}页图片${slotIndex + 1}`} />
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(prompt.iteiDrawPrompt);
                                  setErrorMessage(null);
                                  setInfoMessage(`已复制第 ${slide.page} 页图片 ${slotIndex + 1} 的描述。`);
                                } catch (error) {
                                  setErrorMessage(error instanceof Error ? error.message : '复制失败，请手动复制文本框内容。');
                                }
                              }}
                            >
                              <IconCopy aria-hidden="true" stroke={2} />
                              复制图片描述
                            </Button>
                            <label
                              className={cn(
                                'inline-flex h-8 cursor-pointer items-center gap-1 rounded-sm border border-brand-navy bg-surface px-3 text-[13px] leading-5 font-semibold text-brand-navy transition-colors duration-150 ease-out hover:bg-info-bg',
                                confirmBusy && 'pointer-events-none border-border bg-surface-sunken text-ink-disabled',
                              )}
                            >
                              <IconUpload aria-hidden="true" className="size-4" stroke={2} />
                              {file ? '替换图片' : '上传图片'}
                              <input
                                type="file"
                                accept="image/*"
                                disabled={confirmBusy}
                                className="sr-only"
                                onChange={(event) => {
                                  const selected = event.target.files?.[0];
                                  event.target.value = '';
                                  handleImageUpload(slide.page, slotIndex + 1, slotKey, Boolean(file), selected);
                                }}
                              />
                            </label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-brand-red"
                              onClick={() => {
                                requestConfirm('image_remove', { page: slide.page, slotIndex: slotIndex + 1 }, () => {
                                  onRemoveImage(slotKey);
                                  setInfoMessage('已移除图片，可重新上传。');
                                });
                              }}
                              disabled={!file || confirmBusy}
                            >
                              <IconTrash aria-hidden="true" stroke={2} />
                              移除
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </Card>
      {drawLinkButton}
    </>
  );
}
