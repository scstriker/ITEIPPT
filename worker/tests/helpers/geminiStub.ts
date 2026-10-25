import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type PromptKind = 'plan_draft' | 'plan_insights' | 'content' | 'rewrite' | 'unknown';

export interface StubRequest {
  model: string;
  prompt: string;
  kind: PromptKind;
  /** Value of the x-goog-api-key header. */
  apiKey?: string;
  /** True when the key was (wrongly) sent as a URL query parameter. */
  keyInUrl: boolean;
}

export interface StubReply {
  status?: number;
  json?: unknown;
  rawText?: string;
}

export type StubHandler = (request: StubRequest) => StubReply | undefined;

export interface GeminiStub {
  baseUrl: string;
  requests: StubRequest[];
  setHandler: (handler: StubHandler | undefined) => void;
  close: () => Promise<void>;
}

export function classifyPrompt(prompt: string): PromptKind {
  if (prompt.startsWith('你是 PPT 结构规划助手')) {
    return 'plan_draft';
  }
  if (prompt.startsWith('你是 PPT 框架规划助手')) {
    return 'plan_insights';
  }
  if (prompt.startsWith('You are the ITEISlides content generator.')) {
    return 'content';
  }
  if (prompt.startsWith('Rewrite missing/empty pages only.')) {
    return 'rewrite';
  }
  return 'unknown';
}

export function geminiEnvelope(payload: unknown): unknown {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(payload) }],
        },
      },
    ],
  };
}

interface ChapterLine {
  chapterIndex: number;
  chapterTitle: string;
  slideIndexes: number[];
}

function parseChapterLines(prompt: string): ChapterLine[] {
  const chapters: ChapterLine[] = [];
  for (const line of prompt.split('\n')) {
    const head = /^- chapterIndex=(\d+); chapterTitle=([^;]*);/.exec(line);
    if (!head) {
      continue;
    }
    const slideIndexes = Array.from(line.matchAll(/slideIndex=(\d+);/g)).map((match) => Number(match[1]));
    chapters.push({ chapterIndex: Number(head[1]), chapterTitle: head[2], slideIndexes });
  }
  return chapters;
}

interface PageTask {
  page: number;
  visualMode: string;
  subtitle: string;
}

function parsePageTasks(prompt: string): PageTask[] {
  const lines = prompt.split('\n');
  const tasks: PageTask[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const head = /^- page=(\d+);.*visualMode=(\w+)/.exec(lines[index]);
    if (!head) {
      continue;
    }
    const subtitle = /subtitle=(.*)$/.exec(lines[index + 1] ?? '')?.[1]?.trim() ?? '';
    tasks.push({ page: Number(head[1]), visualMode: head[2], subtitle });
  }
  return tasks;
}

const COVERAGE_CYCLE = ['sufficient', 'moderate', 'sparse'] as const;

function defaultReply(request: StubRequest): StubReply {
  if (request.kind === 'plan_draft') {
    return {
      json: {
        chapters: [1, 2, 3, 4].map((n) => ({
          chapterTitle: `第${n}章 示例章节`,
          slides: [{ subtitle: `示例子章节 ${n}-1`, contentHint: '示例提示', visualMode: n % 2 ? 'table' : 'images' }],
        })),
      },
    };
  }
  if (request.kind === 'plan_insights') {
    const chapters = parseChapterLines(request.prompt);
    return {
      json: {
        chapterInsights: chapters.map((chapter) => ({
          chapterIndex: chapter.chapterIndex,
          reason: `第${chapter.chapterIndex}章与文档内容匹配（示例理由）。`,
          coverageLevel: COVERAGE_CYCLE[(chapter.chapterIndex - 1) % COVERAGE_CYCLE.length],
          sourceHint: `示例线索 ${chapter.chapterIndex}`,
        })),
        slideInsights: chapters.flatMap((chapter) =>
          chapter.slideIndexes.map((slideIndex) => ({
            chapterIndex: chapter.chapterIndex,
            slideIndex,
            visualMode: slideIndex % 2 ? 'table' : 'images',
            reason: `子页面 ${chapter.chapterIndex}-${slideIndex} 示例理由。`,
            sourceHint: `示例线索 ${chapter.chapterIndex}-${slideIndex}`,
          })),
        ),
      },
    };
  }
  if (request.kind === 'content' || request.kind === 'rewrite') {
    const tasks = parsePageTasks(request.prompt);
    return {
      json: {
        slides: tasks.map((task) => ({
          page: task.page,
          bodyText: `${task.subtitle}方面，示例文档给出 3 项要求：测量范围覆盖 0～10 kPa，准确度优于 1%，响应时间不超过 20 ms。第 ${task.page} 页据此给出结论，并列出验证方法。`,
          sourceRef: `示例原文第 ${task.page} 段`,
          sourceConfidence: task.page % 2 ? 'exact' : 'paraphrased',
          aiSupplements: task.page % 2 ? [] : [{ description: `第 ${task.page} 页补充说明（示例）`, type: 'ai_summary' }],
          ...(task.visualMode === 'table'
            ? { tableData: { headers: ['项目', '要求', '依据'], rows: [['测量范围', '0～10 kPa', '第 5 章'], ['准确度', '≤1%', '第 6 章']] } }
            : {}),
          ...(task.visualMode === 'images'
            ? {
                imagePrompts: [
                  { description: `第 ${task.page} 页示意图 1`, iteiDrawPrompt: `pressure sensor diagram page ${task.page} a` },
                  { description: `第 ${task.page} 页示意图 2`, iteiDrawPrompt: `pressure sensor diagram page ${task.page} b` },
                ],
              }
            : {}),
        })),
      },
    };
  }
  return { status: 404, rawText: '{"error":{"message":"stub: unknown prompt"}}' };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function startGeminiStub(initialHandler?: StubHandler): Promise<GeminiStub> {
  let handler = initialHandler;
  const requests: StubRequest[] = [];

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const raw = await readBody(req);
    const url = new URL(req.url ?? '/', 'http://stub');
    const model = /\/models\/([^:]+):generateContent$/.exec(decodeURIComponent(url.pathname))?.[1] ?? '';
    let prompt = '';
    try {
      const body = JSON.parse(raw) as { contents?: Array<{ parts?: Array<{ text?: string }> }> };
      prompt = body.contents?.[0]?.parts?.[0]?.text ?? '';
    } catch {
      prompt = '';
    }
    const apiKey = req.headers['x-goog-api-key'];
    const request: StubRequest = {
      model,
      prompt,
      kind: classifyPrompt(prompt),
      apiKey: typeof apiKey === 'string' ? apiKey : undefined,
      keyInUrl: url.searchParams.has('key'),
    };
    requests.push(request);

    const reply = handler?.(request) ?? defaultReply(request);
    res.statusCode = reply.status ?? 200;
    res.setHeader('content-type', 'application/json');
    res.end(reply.rawText ?? JSON.stringify(geminiEnvelope(reply.json ?? {})));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    setHandler: (next) => {
      handler = next;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
