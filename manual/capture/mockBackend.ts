// Backend for manual screenshots: the real HTTP app (memory jobs, in-process worker) talking to a
// scripted local Gemini. No network, no key. A control port switches scenarios per journey.
// Run from src/: npx tsx ../manual/capture/mockBackend.ts
import { createServer, type IncomingMessage } from 'node:http';
import { createApiApp } from '../../functions/src/http/app';
import { MemoryJobStore } from '../../functions/src/jobs/memoryJobStore';
import { createInlineJobRunner } from '../../functions/src/jobs/runners';

const API_PORT = Number(process.env.MANUAL_API_PORT ?? 8791);
const CONTROL_PORT = Number(process.env.MANUAL_CONTROL_PORT ?? 8792);
const GEMINI_PORT = Number(process.env.MANUAL_GEMINI_PORT ?? 8793);

interface Scenario {
  plan: 'ok' | 'fail' | 'noImages';
  content: 'ok' | 'fail' | 'hangAfterFirstBatch';
  keyMissing: boolean;
}

const DEFAULT_SCENARIO: Scenario = { plan: 'ok', content: 'ok', keyMissing: false };
let scenario: Scenario = { ...DEFAULT_SCENARIO };
let contentCalls = 0;

const gemini = { geminiApiKey: 'mock-key', geminiBaseUrl: `http://127.0.0.1:${GEMINI_PORT}` };

// ---- scripted Gemini -------------------------------------------------------

const VISUAL_MODES: Record<string, 'table' | 'images'> = {
  '1:1': 'table',
  '1:2': 'images',
  '2:1': 'images',
  '2:2': 'table',
  '3:1': 'images',
  '3:2': 'table',
  '3:3': 'table',
  '4:1': 'table',
  '4:2': 'images',
};
const COVERAGE = ['sufficient', 'sufficient', 'sufficient', 'moderate', 'moderate', 'sparse'];
const CHAPTER_REASONS = [
  '编制说明第一部分写明了进口依赖比例和标准缺失情况，足以支撑背景与必要性两页。',
  '文档列出了适用对象、测量范围、准确度和环境要求，适用范围和主要内容可以直接引用。',
  '立项时间、工作组会议、征求意见和验证试验都有具体数字，制定过程材料充分。',
  '先进性有与国际标准的对比，产业化只有预测数据，建议补充已量产企业的情况。',
  '效益部分以预测为主，缺少测算依据，汇报时宜说明测算口径。',
  '该部分原文较短，只说明了与法规的关系和实施建议，可视情况合并或删减。',
];

const TABLES: Array<[RegExp, { headers: string[]; rows: string[][] }]> = [
  [/背景/, { headers: ['现状', '数据', '影响'], rows: [['进口依赖', '约 70%', '供应链风险'], ['供货周期', '16 周', '整机交付延迟'], ['标准情况', '仅整机标准', '零部件无统一要求']] }],
  [/主要内容/, { headers: ['指标', '要求', '条款'], rows: [['测量范围', '-10 kPa～10 kPa', '5.1'], ['准确度', '优于满量程 1%', '5.2'], ['响应时间', '≤20 ms', '5.3']] }],
  [/验证/, { headers: ['项目', '数量', '结论'], rows: [['检测机构', '3 家', '—'], ['型号', '6 个', '全部符合'], ['样品', '60 只', '全部符合']] }],
  [/参编/, { headers: ['单位类别', '数量', '作用'], rows: [['整机厂商', '3 家', '需求与验证'], ['传感器厂商', '4 家', '技术方案'], ['检测机构', '2 家', '试验方法']] }],
  [/先进性|创新/, { headers: ['对比项', '本标准', '国际标准'], rows: [['动态响应', '有要求', '无'], ['耐久试验', '5,000 次', '无'], ['湿热零漂', '≤0.5% FS', '无']] }],
  [/效益/, { headers: ['指标', '预期', '依据'], rows: [['选型周期', '缩短约 30%', '企业调研'], ['采购成本', '降低约 15%', '企业调研'], ['检测费用', '每型号减少 2 万元', '机构报价']] }],
];

const IMAGE_PROMPTS: Array<[RegExp, Array<{ description: string; iteiDrawPrompt: string }>]> = [
  [/必要性/, [
    { description: '国产化必要性示意图', iteiDrawPrompt: '医用呼吸机压力传感器国产化必要性示意图，左侧进口依赖 70%，中间供货周期 16 周，右侧标准缺失，深蓝白色扁平风格' },
    { description: '供应链风险示意图', iteiDrawPrompt: '供应链风险示意图，进口零部件到整机厂商的链条，标出断供风险点，深蓝白色扁平风格' },
  ]],
  [/范围/, [
    { description: '标准适用范围图', iteiDrawPrompt: '标准适用范围示意图，压阻式和电容式压力传感器，安装在呼吸机气路中，深蓝白色扁平风格' },
  ]],
  [/制定过程/, [
    { description: '标准制定流程图', iteiDrawPrompt: '标准制定流程图，立项、起草、征求意见、验证、送审五个阶段，横向箭头，深蓝白色扁平风格' },
  ]],
  [/产业化/, [
    { description: '产业链示意图', iteiDrawPrompt: '压力传感器产业链示意图，敏感元件、封装测试、整机厂商、医疗机构，深蓝白色扁平风格' },
  ]],
];

// Body text per sub-chapter, taken from the sample document so screenshots read naturally.
const BODIES: Array<[RegExp, string, string]> = [
  [/项目背景/, '医用呼吸机是重症救治的关键设备，压力传感器决定通气压力监测的准确性和响应速度。现行国家标准只规定了整机性能，没有针对压力传感器的统一技术要求。', '编制说明一：现行国家标准只规定了呼吸机整机性能'],
  [/必要性/, '国内整机厂商使用的压力传感器约 70% 依赖进口，供货周期长达 16 周。制定本标准可统一技术要求，为国产传感器替代提供检验依据。', '编制说明一：压力传感器约 70% 依赖进口'],
  [/适用范围/, '本标准适用于医用呼吸机气路压力监测用的压阻式和电容式压力传感器，规定了术语和定义、技术要求、试验方法、检验规则以及标志和包装。', '编制说明二：本标准适用于医用呼吸机气路压力监测'],
  [/主要内容/, '主要技术指标包括：测量范围 -10 kPa～10 kPa，准确度优于满量程的 1%，响应时间不超过 20 ms；环境适应性覆盖 10 ℃～40 ℃。', '编制说明二：主要技术指标包括测量范围'],
  [/制定过程/, '2024 年 3 月本项目获批立项。起草组由 9 家单位组成，先后召开 4 次工作组会议；征求意见阶段收到反馈意见 57 条，采纳 41 条。', '编制说明三：2024 年 3 月本项目获批立项'],
  [/验证/, '验证试验在 3 家检测机构完成，覆盖 6 个型号共 60 只样品，全部指标与标准草案一致。', '编制说明三：验证试验在 3 家检测机构完成'],
  [/参编/, '参编单位包括整机厂商 3 家、传感器厂商 4 家和检测机构 2 家，覆盖产业链上下游。', '编制说明三：参编单位包括整机厂商 3 家'],
  [/先进性|创新/, '本标准首次将动态响应时间和压力循环耐久性纳入通用技术要求，并补充了湿热环境下零点漂移不超过满量程 0.5% 的限值。', '编制说明四：首次将动态响应时间纳入'],
  [/产业化/, '已有 4 家国内企业的产品通过验证试验，预计 2 年内国产化率可提高到 50% 以上。', '编制说明四：已有 4 家国内企业的产品通过验证'],
  [/效益/, '标准实施后，预计可缩短整机厂商零部件选型周期约 30%，降低采购成本约 15%，单个型号检测费用减少 2 万元。', '编制说明五：预计可缩短选型周期约 30%'],
  [/其他/, '本标准与现行法律法规和强制性国家标准没有冲突，不涉及专利，建议发布后 6 个月实施。', '编制说明六：与现行法律法规没有冲突'],
];

function envelope(payload: unknown): string {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
}

function planInsights(prompt: string): unknown {
  const chapters: Array<{ chapterIndex: number; slides: number[] }> = [];
  for (const line of prompt.split('\n')) {
    const head = /^- chapterIndex=(\d+);/.exec(line);
    if (!head) {
      continue;
    }
    chapters.push({ chapterIndex: Number(head[1]), slides: Array.from(line.matchAll(/slideIndex=(\d+);/g)).map((m) => Number(m[1])) });
  }
  return {
    chapterInsights: chapters.map(({ chapterIndex }) => ({
      chapterIndex,
      reason: CHAPTER_REASONS[(chapterIndex - 1) % CHAPTER_REASONS.length],
      coverageLevel: COVERAGE[(chapterIndex - 1) % COVERAGE.length],
      sourceHint: `编制说明第 ${chapterIndex} 部分`,
    })),
    slideInsights: chapters.flatMap(({ chapterIndex, slides }) =>
      slides.map((slideIndex) => {
        const visualMode = scenario.plan === 'noImages' ? 'table' : (VISUAL_MODES[`${chapterIndex}:${slideIndex}`] ?? 'table');
        return {
          chapterIndex,
          slideIndex,
          visualMode,
          reason: visualMode === 'images' ? '内容偏流程和关系，适合配示意图。' : '内容偏指标和清单，适合用表格呈现。',
          sourceHint: `编制说明第 ${chapterIndex} 部分`,
        };
      }),
    ),
  };
}

interface PageTask {
  page: number;
  visualMode: string;
  subtitle: string;
  evidence: string[];
}

function pageTasks(prompt: string): PageTask[] {
  const lines = prompt.split('\n');
  const tasks: PageTask[] = [];
  lines.forEach((line, index) => {
    const head = /^- page=(\d+);.*visualMode=(\w+)/.exec(line);
    if (!head) {
      return;
    }
    const subtitle = /subtitle=(.*)$/.exec(lines[index + 1] ?? '')?.[1]?.trim() ?? '';
    const evidenceLine = lines.slice(index + 1, index + 6).find((item) => item.includes('evidence1=')) ?? '';
    const evidence = Array.from(evidenceLine.matchAll(/evidence\d=([^|]+)/g)).map((m) => m[1].trim());
    tasks.push({ page: Number(head[1]), visualMode: head[2], subtitle, evidence });
  });
  return tasks;
}

function contentPayload(prompt: string): unknown {
  return {
    slides: pageTasks(prompt).map((task) => {
      const canned = BODIES.find(([pattern]) => pattern.test(task.subtitle));
      const grounded = Boolean(canned) || task.evidence.length > 0;
      const body = canned?.[1] ?? (task.evidence.length
        ? `${task.evidence.slice(0, 2).join('。')}。`.slice(0, 140)
        : `${task.subtitle}部分原文信息较少，本页先给出框架性说明，建议汇报人补充具体数据。`);
      const table = TABLES.find(([pattern]) => pattern.test(task.subtitle))?.[1];
      const images = IMAGE_PROMPTS.find(([pattern]) => pattern.test(task.subtitle))?.[1];
      return {
        page: task.page,
        bodyText: body,
        sourceRef: canned?.[2] ?? (task.evidence.length ? `编制说明：${task.evidence[0].slice(0, 28)}` : ''),
        sourceConfidence: grounded ? (task.page % 3 === 0 ? 'paraphrased' : 'exact') : 'ai_constructed',
        aiSupplements:
          task.page % 4 === 0
            ? [{ description: '补充了国际标准对比口径，原文未给出出处，需人工确认。', type: 'ai_inference' }]
            : [],
        ...(task.visualMode === 'table' ? { tableData: table ?? { headers: ['项目', '内容', '说明'], rows: [['要点', task.subtitle, '见编制说明']] } } : {}),
        ...(task.visualMode === 'images'
          ? { imagePrompts: images ?? [{ description: `${task.subtitle}示意图`, iteiDrawPrompt: `${task.subtitle}示意图，深蓝白色扁平风格` }] }
          : {}),
      };
    }),
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const geminiServer = createServer(async (req, res) => {
  const raw = await readBody(req);
  let prompt = '';
  try {
    prompt = (JSON.parse(raw) as { contents?: Array<{ parts?: Array<{ text?: string }> }> }).contents?.[0]?.parts?.[0]?.text ?? '';
  } catch {
    prompt = '';
  }
  const reply = (status: number, body: string) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(body);
  };

  if (prompt.startsWith('你是 PPT 框架规划助手')) {
    if (scenario.plan === 'fail') {
      return reply(503, '{"error":{"message":"mock: overloaded"}}');
    }
    return reply(200, envelope(planInsights(prompt)));
  }
  if (prompt.startsWith('You are the ITEISlides content generator.') || prompt.startsWith('Rewrite missing/empty pages only.')) {
    contentCalls += 1;
    if (scenario.content === 'fail') {
      return reply(500, '{"error":{"message":"mock: internal"}}');
    }
    if (scenario.content === 'hangAfterFirstBatch' && contentCalls > 1) {
      return; // never answer: the job stays "running" for the screenshot
    }
    return reply(200, envelope(contentPayload(prompt)));
  }
  return reply(200, envelope({ chapters: [] }));
});

// ---- real backend ---------------------------------------------------------

const jobStore = new MemoryJobStore();
const app = createApiApp({ gemini, jobStore, jobRunner: createInlineJobRunner(jobStore, gemini) });

const controlServer = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/scenario') {
    const patch = JSON.parse((await readBody(req)) || '{}') as Partial<Scenario>;
    scenario = { ...DEFAULT_SCENARIO, ...patch };
    contentCalls = 0;
    gemini.geminiApiKey = scenario.keyMissing ? '' : 'mock-key';
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(scenario));
    return;
  }
  res.statusCode = 404;
  res.end();
});

geminiServer.listen(GEMINI_PORT, '127.0.0.1');
controlServer.listen(CONTROL_PORT, '127.0.0.1');
app.listen(API_PORT, '127.0.0.1', () => {
  console.log(`[manual-mock] api :${API_PORT} control :${CONTROL_PORT} gemini :${GEMINI_PORT}`);
});
