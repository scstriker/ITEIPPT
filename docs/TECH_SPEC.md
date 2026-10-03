# 技术规格：ITEISlides

技术栈选型见 `TechStack/`（Refactor 工作区），界面规范见 `design/itei/AGENTS.md`，本文不重复。接口契约见 `docs/API.md`，安全边界见 `docs/SECURITY.md`。

## 1. 系统概览

单页 Web 应用加一个 Express 后端。浏览器负责文档解析、流程状态、配图管理和 PPTX 渲染；后端只负责调用 Gemini（规划框架、生成逐页内容）和管理异步生成任务。

```text
浏览器（React SPA）
  ├─ pdfjs / mammoth 解析文档
  ├─ PptxGenJS 按 template_structure.json 渲染 PPTX
  └─ fetch /api/*
        │ Firebase Hosting rewrite（线上）或 Vite 代理（本地）
        ▼
Express 应用 createApiApp
  ├─ /api/plan                 → Gemini
  ├─ /api/generate-content     → Gemini（同步，前端已不用）
  └─ /api/generate-content/jobs → JobStore + JobRunner → worker → Gemini
```

## 2. 现有架构（Existing Architecture，重构前，2026-10-03）

### 仓库结构

| 路径 | 内容 |
|---|---|
| `src/` | 前端 Vite 工程根（自带 `package.json`）。React 19、TypeScript 5.8、Vite 6；手写 `styles.css` 2446 行；Tailwind 已安装未接入 |
| `src/components/` | 5 个步骤组件，`FrameworkPlanner.tsx` 1036 行、`ContentAuditor.tsx` 725 行；`ContentGenerator.tsx` 已无引用 |
| `src/hooks/useWorkflow.ts` | 4 步状态机和跨步骤数据 |
| `src/services/apiProxyServer.ts` | 本地后端，2598 行单文件。没有任务接口 |
| `src/services/pptxRenderer.ts` | PPTX 渲染，1113 行 |
| `src/config/` | 模板读取、预设、背景图（base64）；`slidePlan.ts` 只被冒烟脚本使用 |
| `src/types/` | 类型定义，与 `functions/src/types/` 逐字相同 |
| `functions/src/services/apiProxyServer.ts` | 云端后端，3034 行，比本地版多任务接口、自定义模板最少章节、软时限 |
| `functions/src/services/generationJob*.ts` | Firestore + Storage + Pub/Sub 任务存储和 worker |
| `docs/template_structure.json` | 模板结构（运行时资产，被前端直接 import） |

### 现有问题

- 两份后端已分叉。前端调用的 `/api/generate-content/jobs` 只在云端版存在，本地版会把请求落进 `/api/*` 透传，所以本地无法生成内容。
- `/api/*` 透传会把任意路径带上服务器 Key 转发 Gemini，本地和线上都开着。
- 没有测试，只有 3 个冒烟脚本。
- 未用依赖：`@google/genai`、`lucide-react`、`motion`、`cors`。

## 3. 目标架构（Proposed Architecture）

```text
ITEIPPT/
├─ src/                       前端（目录名不变）
│  ├─ app/                    App、AppHeader、Stepper、Footer、全局样式
│  ├─ workflow/               workflowReducer.ts（纯函数）+ useWorkflow.ts
│  ├─ features/<step>/        upload、framework、images、audit、export：组件 + 纯逻辑
│  ├─ components/ui/          shadcn/ui 组件（ITEI 主题）
│  ├─ confirm/                确认弹窗注册表
│  ├─ services/api/           planApi、contentApi
│  ├─ services/document/      documentParser
│  ├─ services/pptx/          按页面类型拆分的渲染器
│  ├─ template/               templateLoader、template_structure.json、背景图、预设
│  ├─ tests/                  Vitest
│  └─ e2e/                    Playwright
└─ functions/src/
   ├─ index.ts                Firebase 触发器（导出名不变）
   ├─ contracts/              前后端共享类型，前端经 @contracts/* 引用（仅类型）
   ├─ gemini/                 请求、JSON 提取、重试
   ├─ plan/                   规划：草案、洞察、降级、自定义模板最少章节
   ├─ content/                生成：证据切片、提示词、高亮、质量检查、组装、降级
   ├─ jobs/                   JobStore、JobRunner 接口及 Firestore / 内存实现，worker
   ├─ http/app.ts             createApiApp({ gemini, jobStore, jobRunner })
   └─ dev/localServer.ts      本地入口：内存 JobStore + 进程内 JobRunner
```

要点：

- 后端只有一份，以云端版为准（ADR-001）。
- 本地 `src` 下 `npm run proxy:dev` 启动 `functions/src/dev/localServer.ts`，读 `src/.env`，监听 8787。
- 删除 `/api/*` 透传，未知路径返回 404。
- 前端按步骤拆分，纯逻辑与组件分离，便于单测。

## 4. 模块职责

| 模块 | 职责 |
|---|---|
| `src/workflow/` | 当前步骤、已解析文档、框架、生成结果及其框架摘要、已导入图片、审阅状态、导出 Blob；步骤解锁规则 |
| `src/features/upload/` | 文件校验、调用解析、摘要和日志 |
| `src/features/framework/` | 预设切换、章节编辑、AI 建议合并、生成任务提交与轮询、sessionStorage 恢复 |
| `src/features/images/` | 图片校验、槽位映射、批量填充 |
| `src/features/audit/` | 指标、筛选分组、预览、正文和表格编辑 |
| `src/features/export/` | 导出预检、组装渲染输入、调用渲染器、下载 |
| `src/services/pptx/` | 读模板、布局计算、cover / toc / content / ending 渲染 |
| `src/confirm/` | 确认弹窗文案注册表和弹窗状态 |
| `functions/src/plan/` | `/api/plan` 业务逻辑 |
| `functions/src/content/` | 逐页内容生成、降级补写、结果组装 |
| `functions/src/jobs/` | 任务创建、入队、进度、结果、清理；worker 执行 |
| `functions/src/http/` | 路由、请求校验、错误码映射 |

## 5. 数据流

1. 上传：浏览器解析出 `ParsedDocument { filename, fileType, textContent }`，回填封面标题、汇报人、机构到 `FrameworkPlan`。
2. 规划：`POST /api/plan { presetId, textContent, chapters }` 返回 `FrameworkPlan`，前端只合并理由、覆盖度和布局（章节为空时整份采用）。
3. 生成：`POST /api/generate-content/jobs` 返回 `jobId`；前端轮询状态，成功后取 `AnalyzerResult`，记录生成时的框架摘要。
4. 配图：图片文件按 `page-{页码}-slot-{序号}` 存在浏览器内存。
5. 审阅：编辑直接改 `AnalyzerResult.slidePlan` 中对应页。
6. 导出：把已导入图片转成 ArrayBuffer，与 `slidePlan` 一起交给渲染器，得到 Blob 后下载。

后端生成过程：按框架展开页面 → 从正文切证据片段 → 每 4 页一批调 Gemini（失败时改用精简提示词再试）→ 缺正文的页重写一次 → 仍缺的页用证据片段补写 → 计算高亮和缺失项 → 组装结果。

## 6. 状态归属

| 状态 | 位置 | 生命周期 |
|---|---|---|
| 流程数据、图片文件、导出 Blob | React state（`useWorkflow`） | 当前标签页；刷新即丢失 |
| 进行中的生成任务 ID 和框架摘要 | `sessionStorage` 键 `itei_step2_active_generation_job` | 当前标签页；任务结束清除 |
| 线上任务状态 | Firestore `generationJobs/{jobId}` | 72 小时 |
| 线上任务请求体和结果 | Cloud Storage `generation-jobs/{jobId}/request.json`、`result.json` | 72 小时 |
| 本地任务 | 本地后端进程内存 | 进程退出即丢失 |

## 7. 接口与集成点

- 前后端 HTTP 接口：`docs/API.md`。
- Gemini：`POST {GEMINI_BASE_URL}/models/{model}:generateContent?key=…`，`responseMimeType: application/json`，`temperature: 0.2`。
- ITEI DRAW：只是外链，无数据交换。
- Firebase：Hosting 把 `/api/**` 改写到函数 `api`，其余路径回到 `index.html`。

## 8. 持久化

只有云端任务数据需要持久化（第 6 节）。没有数据库表结构和迁移，不单独写 DATA_MODEL。

## 9. 错误处理

- 后端错误统一为 `{ error: { code, message, details? } }`，状态码见 API.md。
- 规划：Gemini 失败（缺 Key 除外）时用本地规则兜底，`apiPlanMeta.provider` 带 `:fallback` 后缀。
- 生成：批次失败、接近软时限时补写正文，`generationMeta.mode = 'degraded'`，`reason` 列出原因。同步接口整体失败时返回整份降级结果。
- worker 把异常分类为 `missing_api_key`、`gemini_upstream_error`、`gemini_invalid_json`、`generation_job_failed` 等写进任务。
- 前端把错误码映射成中文提示（`mapPlanErrorToMessage`、`mapGenerateContentError`、`getUploadErrorInfo`）。

## 10. 外部依赖

Gemini API；Firebase Hosting、Functions Gen2、Firestore、Cloud Storage、Pub/Sub、Cloud Scheduler；浏览器端 pdfjs-dist、mammoth、PptxGenJS。

## 11. 可观测性

- 后端用 `console.info('[generate-content][completeness]', …)` 记录每次生成的缺页、补写、降级原因和耗时。
- worker 和清理任务用 `firebase-functions` logger。
- 前端只有上传日志区和错误提示，没有埋点。

## 12. 部署与运行形态

| 环境 | 前端 | 后端 | 任务 |
|---|---|---|---|
| 本地 | Vite 开发服务 `:3000`，`/api` 代理到 `:8787` | `functions/src/dev/localServer.ts`（tsx） | 内存 JobStore，进程内执行 |
| 线上 | Firebase Hosting（`src/dist`） | Functions `api`（`asia-east1`，600 s，512 MiB） | Firestore + Storage，Pub/Sub 主题 `iteippt-generation-content-jobs` 触发 `generationJobWorker`（540 s），`generationJobCleanup` 每 24 小时 |

部署步骤见 `docs/cloud-deployment.md`。

## 13. 技术约束

- JSON 请求体上限 8 MB；规划取正文前 12 万字符，生成取前 18 万字符，提示词内正文最多 3.6 万字符（精简版 8000）。
- 生成每批 4 页；单次 Gemini 调用最多试 2 次，只重试 408、429、5xx 和 JSON 解析失败。
- 生成软时限 500 秒，留 20 秒余量。前端轮询间隔 2 秒，最长等 20 分钟。
- 模板目录页只有 6 行，导出最多支持 6 个章节。
- Functions 运行时为 `nodejs20`，需核实平台支持期限。

## 14. 已知限制

- “目标页数”未被使用（PRD Q-1）。
- 超过 6 个章节导出失败（PRD Q-2）。
- SVG、WEBP 图片可能导出失败（PRD Q-4）。
- 后端提示词有 5 处乱码（PRD Q-5）。
- 浏览器刷新会丢失已解析文档、框架和已导入图片；进行中的生成任务也无法恢复（PRD Q-7）。
- 本地任务存在内存里，后端重启后进行中的任务丢失。
- 重构前，`npm run dev`（StrictMode）下生成任务查询一次后停止（PRD Q-9），E2E 因此跑生产构建（`vite build` + `vite preview`）。

## 15. 相关决策

- `docs/decisions/ADR-001-single-backend.md`
- `docs/decisions/ADR-002-no-agent-runtime.md`
- `docs/decisions/ADR-003-stack-alignment.md`
