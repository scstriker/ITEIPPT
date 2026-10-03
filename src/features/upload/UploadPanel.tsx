import { type ChangeEvent, useMemo, useState } from 'react';
import { IconFileUpload } from '@tabler/icons-react';
import { Card, Field, Notice, SubTitle } from '@/components/itei/Blocks';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  ALLOWED_EXTENSIONS,
  DEFAULT_ORGANIZATION,
  DEFAULT_TARGET_SLIDES,
  MAX_FILE_SIZE_MB,
  PARSE_TIMEOUT_MS,
  buildSummary,
  clampTargetSlides,
  formatSizeKb,
  validateSelection,
} from './uploadRules';
import {
  DocumentParseError,
  getUploadErrorInfo,
  parseDocument,
  type ParsedDocument,
} from '../../services/document/documentParser';

interface UploadPanelProps {
  parsedDocument: ParsedDocument | null;
  onParsed: (
    document: ParsedDocument,
    meta?: {
      presenter?: string;
      organization?: string;
    },
  ) => void;
  maxFileSizeMb?: number;
  timeoutMs?: number;
}

interface UploadLogEntry {
  id: number;
  level: 'info' | 'success' | 'error';
  message: string;
  time: string;
}

function formatNowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    hour12: false,
  });
}

export function UploadPanel({
  parsedDocument,
  onParsed,
  maxFileSizeMb = MAX_FILE_SIZE_MB,
  timeoutMs = PARSE_TIMEOUT_MS,
}: UploadPanelProps) {
  const [isParsing, setIsParsing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [selectedFileSizeBytes, setSelectedFileSizeBytes] = useState<number>(0);

  const [targetSlides, setTargetSlides] = useState<number>(DEFAULT_TARGET_SLIDES);
  const [presenter, setPresenter] = useState('');
  const [organization, setOrganization] = useState(DEFAULT_ORGANIZATION);

  const [logs, setLogs] = useState<UploadLogEntry[]>([
    {
      id: 1,
      level: 'info',
      message: '等待上传文档…',
      time: formatNowTime(),
    },
  ]);

  const maxFileSizeBytes = useMemo(() => maxFileSizeMb * 1024 * 1024, [maxFileSizeMb]);
  const summary = useMemo(() => buildSummary(parsedDocument), [parsedDocument]);

  const pushLog = (level: UploadLogEntry['level'], message: string) => {
    setLogs((prev) => [
      ...prev,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        level,
        message,
        time: formatNowTime(),
      },
    ]);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = input.files;
    if (!files || files.length === 0) {
      return;
    }

    if (files.length > 1) {
      const message = validateSelection(files, maxFileSizeMb) ?? '';
      setErrorMessage(message);
      pushLog('error', message);
      return;
    }

    const file = files[0];
    input.value = '';
    setSelectedFilename(file.name);
    setSelectedFileSizeBytes(file.size);
    setErrorMessage(null);
    pushLog('info', `已选择文件：${file.name}`);

    const selectionError = validateSelection([file], maxFileSizeMb);
    if (selectionError) {
      setErrorMessage(selectionError);
      pushLog('error', selectionError);
      return;
    }

    setIsParsing(true);
    pushLog('info', '开始提取并分析文档内容…');

    try {
      const parsed = await parseDocument(file, {
        timeoutMs,
        maxFileSizeBytes,
      });
      const normalizedPresenter = presenter.trim();
      const normalizedOrganization = organization.trim();
      onParsed(parsed, {
        presenter: normalizedPresenter || undefined,
        organization: normalizedOrganization || undefined,
      });
      pushLog('success', '文档已解析并可进入下一步。');
    } catch (error) {
      const info = getUploadErrorInfo(error);
      setErrorMessage(info.message);
      pushLog('error', info.message);
      if (!(error instanceof DocumentParseError)) {
        // eslint-disable-next-line no-console
        console.error('[UploadPanel] Unexpected parse error:', error);
      }
    } finally {
      setIsParsing(false);
    }
  };

  const statusText = (() => {
    if (isParsing) {
      return selectedFilename ? `解析中：${selectedFilename}` : '解析中，请稍候…';
    }
    if (selectedFilename && parsedDocument?.filename === selectedFilename) {
      return '';
    }
    if (selectedFilename) {
      return `已选择：${selectedFilename}`;
    }
    return '尚未选择文件。';
  })();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <Card title="基础设置">
          <div className="flex flex-col gap-4">
            <Field label="目标页数" htmlFor="targetSlides">
              <Input
                id="targetSlides"
                type="number"
                min={4}
                value={targetSlides}
                onChange={(event) => setTargetSlides(clampTargetSlides(Number(event.target.value)))}
              />
            </Field>
            <Field label="汇报人" htmlFor="presenter">
              <Input
                id="presenter"
                type="text"
                placeholder="可选"
                value={presenter}
                onChange={(event) => setPresenter(event.target.value)}
              />
            </Field>
            <Field label="所属机构" htmlFor="organization">
              <Input id="organization" type="text" value={organization} onChange={(event) => setOrganization(event.target.value)} />
            </Field>
          </div>
        </Card>

        <section aria-label="处理日志" className="max-h-72 overflow-y-auto border border-border bg-surface-sunken p-3 font-mono text-[13px] leading-5">
          {logs.map((log) => (
            <div
              key={log.id}
              className={log.level === 'error' ? 'text-brand-red' : log.level === 'success' ? 'text-success' : 'text-ink-muted'}
            >
              [{log.time}] {log.level === 'error' ? <span className="font-semibold">错误 </span> : null}
              {log.message}
            </div>
          ))}
        </section>
      </div>

      <Card title="上传文档" bodyClassName="flex flex-col gap-4">
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed px-6 py-10 text-center transition-colors duration-150 ease-out hover:border-brand-navy hover:bg-info-bg',
            selectedFilename ? 'border-brand-sky bg-info-bg' : 'border-border-strong bg-surface',
            isParsing && 'cursor-wait',
          )}
        >
          <input
            type="file"
            multiple={false}
            accept={ALLOWED_EXTENSIONS.join(',')}
            onChange={handleFileChange}
            disabled={isParsing}
            className="sr-only"
          />
          <IconFileUpload aria-hidden="true" className="size-10 text-brand-navy" stroke={1.5} />
          <strong className="text-base leading-6 font-bold text-brand-navy">{isParsing ? '解析中，请稍候…' : '点击选择文档'}</strong>
          <span className="text-[13px] leading-5 text-ink-muted">
            支持格式：{ALLOWED_EXTENSIONS.join(' / ')}，最大 {maxFileSizeMb}MB
          </span>
        </label>

        {selectedFilename ? (
          <div className="flex items-center justify-between border border-border bg-surface-sunken px-3 py-2 text-[13px] leading-5">
            <span className="font-semibold text-ink">{selectedFilename}</span>
            <span className="text-ink-muted tabular-nums">{formatSizeKb(selectedFileSizeBytes)}</span>
          </div>
        ) : null}

        {statusText ? <div className="text-[13px] leading-5 text-ink-muted">{statusText}</div> : null}
        {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}

        <div className="flex flex-col gap-3">
          <SubTitle>文档摘要</SubTitle>
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              ['标题', summary.title],
              ['领域', summary.domain],
              ['关键词', summary.keywords],
              ['摘要', summary.abstract],
            ].map(([label, value]) => (
              <div key={label} className="border border-border bg-surface-sunken p-3">
                <dt className="text-xs leading-4 text-ink-muted">{label}</dt>
                <dd className="mt-1 text-[13px] leading-5 break-words whitespace-pre-wrap text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>
    </div>
  );
}
