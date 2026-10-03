import { type ChangeEvent, useMemo, useState } from 'react';
import {
  DocumentParseError,
  getUploadErrorInfo,
  parseDocument,
  type ParsedDocument,
} from '../services/documentParser';

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

const ALLOWED_EXTENSIONS = ['.pdf', '.docx'];
const DEFAULT_TARGET_SLIDES = 20;
const DEFAULT_ORGANIZATION = '机械工业仪器仪表综合技术经济研究所';

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function formatNowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    hour12: false,
  });
}

function formatSizeKb(sizeBytes: number): string {
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

function buildSummary(parsedDocument: ParsedDocument | null): {
  title: string;
  domain: string;
  keywords: string;
  abstract: string;
} {
  if (!parsedDocument) {
    return {
      title: '待上传文档',
      domain: '-',
      keywords: '-',
      abstract: '上传并解析后将显示文档摘要。',
    };
  }

  const lines = parsedDocument.textContent
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const title = lines[0] ?? parsedDocument.filename;
  const abstract = parsedDocument.textContent.slice(0, 160) || '未提取到摘要内容。';
  const keywords =
    lines
      .slice(1, 20)
      .join(' ')
      .replace(/[，。、“”‘’；：,.!?]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 2)
      .slice(0, 8)
      .join('、') || '-';

  return {
    title,
    domain: parsedDocument.fileType.toUpperCase(),
    keywords,
    abstract,
  };
}

export function UploadPanel({
  parsedDocument,
  onParsed,
  maxFileSizeMb = 20,
  timeoutMs = 45_000,
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
      const message = '一次仅支持上传一个文件，请重新选择。';
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

    if (!hasAllowedExtension(file.name)) {
      const message = '文件格式不支持，仅允许 .pdf / .docx。';
      setErrorMessage(message);
      pushLog('error', message);
      return;
    }

    if (file.size > maxFileSizeBytes) {
      const message = `文件过大，请上传不超过 ${maxFileSizeMb}MB 的文档。`;
      setErrorMessage(message);
      pushLog('error', message);
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
    <section className="panel">
      <div className="panel-grid upload-panel-grid">
        <div className="upload-left-column">
          <article className="card">
            <header className="card-header">基础设置</header>
            <div className="card-body">
              <div className="form-group">
                <label htmlFor="targetSlides">目标页数</label>
                <input
                  id="targetSlides"
                  type="number"
                  min={4}
                  value={targetSlides}
                  onChange={(event) => setTargetSlides(Math.max(4, Number(event.target.value) || 4))}
                />
              </div>

              <div className="form-group">
                <label htmlFor="presenter">汇报人</label>
                <input
                  id="presenter"
                  type="text"
                  placeholder="可选"
                  value={presenter}
                  onChange={(event) => setPresenter(event.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="organization">所属机构</label>
                <input
                  id="organization"
                  type="text"
                  value={organization}
                  onChange={(event) => setOrganization(event.target.value)}
                />
              </div>
            </div>
          </article>

          <article className="log-panel">
            {logs.map((log) => (
              <div key={log.id} className={`log-${log.level}`}>
                [{log.time}] {log.message}
              </div>
            ))}
          </article>
        </div>

        <article className="card">
          <header className="card-header">上传文档</header>
          <div className="card-body">
            <label className={`upload-zone ${selectedFilename ? 'has-file' : ''}`}>
              <input
                type="file"
                multiple={false}
                accept={ALLOWED_EXTENSIONS.join(',')}
                onChange={handleFileChange}
                disabled={isParsing}
                className="hidden-file-input"
              />
              <div className="upload-icon">📂</div>
              <div className="upload-text">
                <strong>{isParsing ? '解析中，请稍候…' : '点击选择文档'}</strong>
                <div>支持格式：{ALLOWED_EXTENSIONS.join(' / ')}，最大 {maxFileSizeMb}MB</div>
              </div>
            </label>

            {selectedFilename ? (
              <div className="file-info">
                <span className="name">{selectedFilename}</span>
                <span className="size">{formatSizeKb(selectedFileSizeBytes)}</span>
              </div>
            ) : null}

            {statusText ? <div className="status-line">{statusText}</div> : null}
            {errorMessage ? <p className="message-error">{errorMessage}</p> : null}

            <div className="summary-section">
              <h3>文档摘要</h3>
              <div className="summary-card">
                <article className="summary-item">
                  <div className="label">标题</div>
                  <div className="value">{summary.title}</div>
                </article>
                <article className="summary-item">
                  <div className="label">领域</div>
                  <div className="value">{summary.domain}</div>
                </article>
                <article className="summary-item">
                  <div className="label">关键词</div>
                  <div className="value">{summary.keywords}</div>
                </article>
                <article className="summary-item">
                  <div className="label">摘要</div>
                  <div className="value">{summary.abstract}</div>
                </article>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
