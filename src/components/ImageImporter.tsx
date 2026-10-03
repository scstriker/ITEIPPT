import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConfirmRequest } from '../confirm/confirmActions';
import { getImageSlotKey } from '../hooks/useWorkflow';
import type { AnalyzerResult } from '@contracts/analyzer';

interface ImageImporterProps {
  analyzerResult: AnalyzerResult | null;
  importedImages: Map<string, File>;
  requestConfirm: ConfirmRequest;
  confirmBusy: boolean;
  onImportImage: (slotKey: string, file: File) => void;
  onRemoveImage: (slotKey: string) => void;
}

const MAX_IMAGE_FILE_MB = 12;

function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) {
    return `文件“${file.name}”不是图片格式，请重新选择。`;
  }
  const maxSizeBytes = MAX_IMAGE_FILE_MB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return `文件“${file.name}”超过 ${MAX_IMAGE_FILE_MB}MB，请压缩后再上传。`;
  }
  return null;
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
    return <div className="image-slot-preview-empty">未上传图片</div>;
  }

  return <img src={previewUrl} alt={alt} className="image-slot-preview-img" />;
}

function getSlidePrompts(slide: NonNullable<AnalyzerResult['slidePlan']>[number]) {
  if (slide.imagePrompts?.length) {
    return slide.imagePrompts;
  }
  return [
    {
      description: '图片描述待生成',
      iteiDrawPrompt: '',
    },
  ];
}

export function ImageImporter({
  analyzerResult,
  importedImages,
  requestConfirm,
  confirmBusy,
  onImportImage,
  onRemoveImage,
}: ImageImporterProps) {
  const imageSlides = useMemo(
    () =>
      (analyzerResult?.slidePlan ?? []).filter((slide) => slide.type === 'content' && slide.visualMode === 'images'),
    [analyzerResult],
  );
  const [expandedPage, setExpandedPage] = useState<number | null>(null);
  const bulkInputRef = useRef<HTMLInputElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const allSlots = useMemo(
    () =>
      imageSlides.flatMap((slide) =>
        getSlidePrompts(slide).map((_, slotIndex) => ({
          page: slide.page,
          slotIndex,
          key: getImageSlotKey(slide.page, slotIndex),
        })),
      ),
    [imageSlides],
  );

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
      className="itei-draw-float-link"
      href="https://draw.sensor-cloud.org/"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="打开 ITEI DRAW"
    >
      ITEI DRAW
    </a>
  );

  if (!imageSlides.length) {
    return (
      <section className="panel">
        <article className="card">
          <header className="card-header">Step 3 · 配图导入</header>
          <div className="card-body">
            <p className="panel-hint">当前内容中没有需要图片的页面，可直接进入审计预览。</p>
          </div>
        </article>
        {drawLinkButton}
      </section>
    );
  }

  return (
    <section className="panel">
      <article className="card">
        <header className="card-header">Step 3 · 配图导入</header>
        <div className="card-body image-importer-body">
          <div className="image-importer-toolbar">
            <p className="panel-hint">
              导入方式 1：复制“图片描述”到 ITEI Draw 生成图片后上传到对应槽位；
              导入方式 2：直接上传你自己的本地图片（可替换）。
            </p>
            <p className="panel-hint">
              当前进度：已导入 {importedSlotCount}/{allSlots.length}，待导入 {missingSlotCount}。
            </p>
            <label className="bulk-upload-inline" htmlFor="bulk-import-input">
              批量导入图片
            </label>
            <input
              id="bulk-import-input"
              ref={bulkInputRef}
              type="file"
              accept="image/*"
              multiple
              disabled={confirmBusy}
              className="bulk-upload-input"
              onChange={(event) => {
                const files = event.target.files ? Array.from(event.target.files) : [];
                event.target.value = '';
                if (!files.length) {
                  return;
                }

                const emptySlots = allSlots.filter((slot) => !importedImages.has(slot.key));
                const validated: File[] = [];
                for (const file of files) {
                  const validationError = validateImageFile(file);
                  if (validationError) {
                    setErrorMessage(validationError);
                    return;
                  }
                  validated.push(file);
                }

                const appliedCount = Math.min(emptySlots.length, validated.length);
                if (appliedCount <= 0) {
                  setInfoMessage('当前没有可填充的空槽位，未执行批量导入。');
                  return;
                }

                requestConfirm(
                  'image_bulk_import',
                  {
                    fileCount: validated.length,
                    availableSlots: emptySlots.length,
                  },
                  () => {
                    emptySlots.slice(0, appliedCount).forEach((slot, index) => {
                      onImportImage(slot.key, validated[index]);
                    });
                    setErrorMessage(null);
                    if (validated.length > emptySlots.length) {
                      setInfoMessage(`已导入 ${appliedCount} 张图片，超出的 ${validated.length - appliedCount} 张未使用。`);
                    } else {
                      setInfoMessage(`已批量导入 ${appliedCount} 张图片。`);
                    }
                  },
                );
              }}
            />
          </div>

          {errorMessage ? <p className="message-error">{errorMessage}</p> : null}
          {infoMessage ? <p className="message-warning">{infoMessage}</p> : null}

          <div className="image-page-list">
            {imageSlides.map((slide) => {
              const prompts = getSlidePrompts(slide);
              const isExpanded = expandedPage === slide.page;

              return (
                <article key={slide.page} className={`image-page-card${isExpanded ? ' expanded' : ''}`}>
                  <button
                    type="button"
                    className="image-page-toggle"
                    onClick={() => setExpandedPage((prev) => (prev === slide.page ? null : slide.page))}
                    aria-expanded={isExpanded}
                  >
                    <span className="image-page-arrow">▶</span>
                    <span className="image-page-title">
                      第 {slide.page} 页 · {slide.subtitle ?? slide.chapterTitle}
                    </span>
                    <span className="image-page-count">{prompts.length}</span>
                  </button>

                  <div className="image-page-body">
                    {prompts.map((prompt, slotIndex) => {
                      const slotKey = getImageSlotKey(slide.page, slotIndex);
                      const file = importedImages.get(slotKey) ?? null;

                      return (
                        <div key={slotKey} className="image-slot-row">
                          <div className="image-slot-grid">
                            <div className="image-slot-prompt">
                              <span className="image-slot-label">图片 {slotIndex + 1} 描述</span>
                              <textarea readOnly value={prompt.iteiDrawPrompt} className="prompt-box" />
                            </div>
                            <div className="image-slot-preview">
                              <span className="image-slot-label">预览</span>
                              <div className="image-slot-preview-frame">
                                <ImagePreview file={file} alt={`第${slide.page}页图片${slotIndex + 1}`} />
                              </div>
                            </div>
                          </div>

                          <div className="image-slot-actions">
                            <button
                              type="button"
                              className="btn btn-secondary image-action-btn"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(prompt.iteiDrawPrompt);
                                  setErrorMessage(null);
                                  setInfoMessage(`已复制第 ${slide.page} 页图片 ${slotIndex + 1} 的描述。`);
                                } catch (error) {
                                  setErrorMessage(
                                    error instanceof Error ? error.message : '复制失败，请手动复制文本框内容。',
                                  );
                                }
                              }}
                            >
                              复制图片描述
                            </button>
                            <label className="upload-inline image-action-btn upload-btn-inline">
                              {file ? '替换图片' : '上传图片'}
                              <input
                                type="file"
                                accept="image/*"
                                disabled={confirmBusy}
                                onChange={(event) => {
                                  const selected = event.target.files?.[0];
                                  event.target.value = '';
                                  handleImageUpload(
                                    slide.page,
                                    slotIndex + 1,
                                    slotKey,
                                    Boolean(file),
                                    selected,
                                  );
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              className="danger-ghost image-action-btn"
                              onClick={() => {
                                requestConfirm(
                                  'image_remove',
                                  {
                                    page: slide.page,
                                    slotIndex: slotIndex + 1,
                                  },
                                  () => {
                                    onRemoveImage(slotKey);
                                    setInfoMessage('已移除图片，可重新上传。');
                                  },
                                );
                              }}
                              disabled={!file || confirmBusy}
                            >
                              移除
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </article>
      {drawLinkButton}
    </section>
  );
}

