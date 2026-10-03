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

## 2. 现有架构（Existing Architecture，2026-10-03 重构后）

### 仓库结构

```text
ITEIPPT/
├─ src/                       前端 Vite 工程根（自带 package.json，目录名沿用旧名）
│  ├─ app/                    App、main、globals.css（Tailwind 4 + ITEI tokens + shadcn 主题映射）
│  ├─ components/itei/        ITEI 骨架与小组件：AppHeader、StepNav、AppFooter、Card、Notice、KpiTile
│  ├─ components/ui/          shadcn/ui 组件（radix、Tabler 图标），已按 ITEI 规则改样式
│  ├─ workflow/               workflowReducer.ts（纯函数）+ useWorkflow.ts
│  ├─ features/upload|framework|images|audit|export/   步骤组件 + 纯逻辑模块
│  ├─ confirm/                确认弹窗文案注册表、弹窗（Radix Dialog）
│  ├─ services/api/           planApi、contentApi
│  ├─ services/document/      documentParser（pdfjs、mammoth）
│  ├─ services/pptx/          renderPptx 入口；cover / toc / content / ending 页；textStyle、textLayout、geometry、images、templateRefs
│  ├─ template/               templateLoader、template_structure.json、背景图、预设
│  ├─ scripts/phase1Gate.ts   结构门禁（与 docs/reference/ 模板原件比对）
│  ├─ tests/                  Vitest 单元与渲染快照
│  └─ e2e/                    Playwright（support/ 假后端与页面辅助函数，fixtures/ 合成示例文件）
├─ functions/                 后端 Firebase Functions，见 functions/README.md
│  ├─ src/index.ts            触发器 api / generationJobWorker / generationJobCleanup
│  ├─ src/http/               createApiApp({ gemini, jobStore, jobRunner })、错误响应
│  ├─ src/plan/  src/content/  src/gemini/  src/shared/
│  ├─ src/jobs/               JobStore、JobRunner 接口；firestoreJobStore、MemoryJobStore；runners；worker
│  ├─ src/contracts/          前后端共享类型（前端经 @contracts/* 只引用类型）
│  ├─ src/dev/localServer.ts  本地入口（内存任务、进程内执行，不参与部署构建）
│  └─ tests/                  Vitest；helpers/geminiStub.ts 模拟 Gemini
├─ design/itei/               ITEI 设计规范（tokens.css 由前端直接 import）
└─ docs/                      本文档集；reference/ 放模板原件与说明
```

### 运行时组件

浏览器 SPA、Express 应用（线上为函数 `api`，本地为 `localServer`）、Gemini、线上任务基础设施（Firestore、Cloud Storage、Pub/Sub、Cloud Scheduler）。

### 边界

- 前端只通过 `/api/*` 访问后端，契约见 `API.md`；类型来自 `functions/src/contracts/`。
- 后端只有一份实现。线上与本地的差别只在装配：`index.ts` 装配 Firestore 存储和 Pub/Sub 执行器，`localServer.ts` 装配内存存储和进程内执行器（ADR-001）。
- 未定义的 `/api/*` 返回 404，不转发 Gemini。

### 重构记录

重构前（基线提交 `159df77`）的问题与处理：

| 问题 | 处理 |
|---|---|
| 两份后端（本地 2598 行、云端 3034 行）已分叉；本地版没有任务接口，本地无法生成内容 | 合并为 `functions/src/` 一份，按模块拆分，本地用内存任务 |
| `/api/*` 把任意请求带上服务器 Key 透传 Gemini | 删除，未知路径 404 |
| `storage.rules` 对 `pptx-versions` 公开读写 | 改为全部拒绝 |
| 类型文件两处复制；`template_structure.json` 放在 `docs/` | `functions/src/contracts/`；`src/template/` |
| `FrameworkPlanner` 1036 行、`ContentAuditor` 725 行、渲染器 1113 行；无测试 | 纯逻辑抽出并单测；渲染器按页面类型拆分；补 Vitest 与 Playwright |
| TypeScript 5.8、Vite 6、手写 CSS 2446 行 | TypeScript 7、Vite 8、Tailwind 4 + shadcn/ui，界面改为 ITEI 规范（ADR-003） |
| 开发服务器（StrictMode）下生成任务查询一次后停止 | `useGenerationJob` 挂载时复位卸载标记 |

## 3. 目标架构（Proposed Architecture）

暂无计划中的架构变更。第 14 节和 PRD 第 11 节的待定问题需要用户决定后再改。

## 4. 模块职责

| 模块 | 职责 |
|---|---|
| `src/workflow/` | 当前步骤、已解析文档、框架、生成结果及其框架摘要、已导入图片、审阅状态、导出 Blob；步骤解锁规则 |
| `src/features/upload/` | `uploadRules`：文件校验、摘要；`UploadPanel`：解析、日志 |
| `src/features/framework/` | `frameworkEditing`：章节编辑、预设、AI 建议合并、提示文案；`useGenerationJob`：任务提交、轮询、sessionStorage 记录；`FrameworkPlanner`：界面 |
| `src/features/images/` | `imageSlots`：槽位、校验、批量填充；`ImageImporter`：界面 |
| `src/features/audit/` | `auditModel`：指标、问题计数、筛选分组、表格编辑；`ContentAuditor`：界面 |
| `src/features/export/` | `exportPreflight`：预检、风险摘要、渲染输入；`GeneratePanel`：渲染与下载 |
| `src/services/pptx/` | 读模板、布局计算、按页面类型渲染 |
| `src/confirm/` | 确认弹窗文案注册表和弹窗状态 |
| `src/components/` | ITEI 骨架和 shadcn/ui 基础组件，不含业务逻辑 |
| `functions/src/plan/` | `/api/plan` 业务逻辑 |
| `functions/src/content/` | 逐页内容生成、降级补写、结果组装 |
| `functions/src/jobs/` | 任务记录规则（`jobRecord`）、存储实现、执行器、worker |
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
- Key 无效时 `/api/plan` 静默降级为本地规则，界面看不出是 Key 的问题（PRD Q-10）。
- 超过 6 个章节导出失败（PRD Q-2）。
- SVG、WEBP 图片可能导出失败（PRD Q-4）。
- 后端提示词有 5 处乱码（PRD Q-5）。
- 浏览器刷新会丢失已解析文档、框架和已导入图片；进行中的生成任务也无法恢复（PRD Q-7）。
- 本地任务存在内存里，后端重启后进行中的任务丢失。
- E2E 默认跑生产构建（`vite build` + `vite preview`），与用户拿到的一致；`E2E_DEV=1 npm run e2e:local` 在开发服务器（StrictMode）上跑本地全流程。

## 15. 相关决策

- `docs/decisions/ADR-001-single-backend.md`
- `docs/decisions/ADR-002-no-agent-runtime.md`
- `docs/decisions/ADR-003-stack-alignment.md`
