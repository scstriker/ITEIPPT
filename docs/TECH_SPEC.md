# 技术规格：ITEISlides

技术栈选型见 `TechStack/`（Refactor 工作区），界面规范见 `design/itei/AGENTS.md`，本文不重复。接口契约见 `docs/API.md`，安全边界见 `docs/SECURITY.md`，部署见 `docs/cloudflare-deployment.md`。

## 1. 系统概览

单页 Web 应用加一个 Cloudflare Worker。浏览器负责文档解析、流程状态、内容生成的分批调度、配图管理和 PPTX 渲染；Worker 提供静态页面，并负责两件需要 Gemini Key 的事：规划框架、生成一批逐页内容。

```text
访问者
  │ Cloudflare Access（邮箱验证码，只放行名单内邮箱）
  ▼
Cloudflare Worker iteislides（slides.sensor-cloud.org）
  ├─ 静态资源 src/dist（单页应用回退）
  └─ /api/*  校验 Access JWT → createApiHandler
       ├─ POST /api/plan                   → Gemini
       └─ POST /api/generate-content/batch → Gemini（一批 1～4 页）

浏览器（React SPA）
  ├─ pdfjs / mammoth 解析文档
  ├─ orchestrate.generateContent：分批、软时限、组装 AnalyzerResult
  └─ PptxGenJS 按 template_structure.json 渲染 PPTX
```

## 2. 现有架构（Existing Architecture，2026-10-25）

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
│  ├─ services/api/           planApi、contentApi（批次请求）
│  ├─ services/document/      documentParser（pdfjs、mammoth）
│  ├─ services/pptx/          renderPptx 入口；cover / toc / content / ending 页；textStyle、textLayout、geometry、images、templateRefs
│  ├─ template/               templateLoader、template_structure.json、背景图、预设
│  ├─ public/_headers         静态资源的安全响应头
│  ├─ scripts/phase1Gate.ts   结构门禁（与 docs/reference/ 模板原件比对）
│  ├─ tests/                  Vitest 单元与渲染快照
│  └─ e2e/                    Playwright（support/ 假后端与页面辅助函数，fixtures/ 合成示例文件）
├─ worker/                    后端 Cloudflare Worker，见 worker/README.md
│  ├─ src/index.ts            Worker 入口：静态资源 / API，按变量装配 Access 校验
│  ├─ src/http/               createApiHandler、Access JWT 校验、批次请求校验、错误响应
│  ├─ src/plan/  src/gemini/  src/shared/
│  ├─ src/content/            batch.ts（Worker 内单批生成）、orchestrate.ts（浏览器内分批与组装）及证据、提示词、高亮、补写
│  ├─ src/contracts/          前后端共享类型（前端经 @contracts/* 引用；@worker/* 引用 content 等）
│  ├─ src/dev/                本地开发服务器、node:http 适配器（不参与部署）
│  ├─ scripts/workerdSmoke.ts 本机 Cloudflare 运行时冒烟
│  ├─ tests/                  Vitest；helpers/geminiStub.ts 模拟 Gemini
│  └─ wrangler.jsonc          Worker 配置（不含密钥）
├─ manual/                    使用手册的源文件与生成脚本
├─ design/itei/               ITEI 设计规范（tokens.css 由前端直接 import）
└─ docs/                      本文档集；reference/ 放模板原件与说明
```

### 运行时组件

浏览器 SPA、Cloudflare Access、Cloudflare Worker（含静态资源）、Gemini。没有数据库和任务队列。

### 边界

- 前端只通过 `/api/*` 访问后端，契约见 `API.md`。
- 后端只有一个处理函数 `createApiHandler`，Worker、本地开发服务器和测试共用。Worker 装配 Access 校验；本地服务器只监听 127.0.0.1，不校验。
- 未定义的 `/api/*` 返回 404，不转发 Gemini。

### 变更记录

| 时间 | 变更 |
|---|---|
| 2026-10-03 | 重构：合并两份后端；删除 `/api/*` 透传；前端改为 TS 7、Vite 8、Tailwind 4 + shadcn/ui 和 ITEI 界面（ADR-001、ADR-003） |
| 2026-10-25 | 部署改为 Cloudflare Worker，删除 Firebase、异步任务和服务器端存储；内容生成改由浏览器逐批驱动；加 Cloudflare Access（ADR-004） |

## 3. 目标架构（Proposed Architecture）

暂无计划中的架构变更。第 14 节和 PRD 第 11 节的待定问题需要用户决定后再改。

## 4. 模块职责

| 模块 | 职责 |
|---|---|
| `src/workflow/` | 当前步骤、已解析文档、框架、生成结果及其框架摘要、已导入图片、审阅状态、导出 Blob；步骤解锁规则 |
| `src/features/upload/` | `uploadRules`：文件校验、摘要；`UploadPanel`：解析、日志 |
| `src/features/framework/` | `frameworkEditing`：章节编辑、预设、AI 建议合并、提示文案；`useContentGeneration`：调用 orchestrator、进度文字、错误映射；`FrameworkPlanner`：界面 |
| `src/features/images/` | `imageSlots`：槽位、校验、批量填充；`ImageImporter`：界面 |
| `src/features/audit/` | `auditModel`：指标、问题计数、筛选分组、表格编辑；`ContentAuditor`：界面 |
| `src/features/export/` | `exportPreflight`：预检、风险摘要、渲染输入；`GeneratePanel`：渲染与下载 |
| `src/services/api/` | `planApi`、`contentApi`（`requestContentBatch`、错误映射） |
| `src/services/pptx/` | 读模板、布局计算、按页面类型渲染 |
| `worker/src/http/` | 路由、请求体上限、批次校验、Access JWT 校验、错误码 |
| `worker/src/plan/` | `/api/plan` 业务逻辑 |
| `worker/src/content/` | `batch`：单批 Gemini 调用、重试、改写、补写；`orchestrate`：分批、软时限、组装；其余为证据、提示词、高亮、缺失项 |

## 5. 数据流

1. 上传：浏览器解析出 `ParsedDocument { filename, fileType, textContent }`，回填封面标题、汇报人、机构到 `FrameworkPlan`。
2. 规划：`POST /api/plan { presetId, textContent（前 15 万字符）, chapters }` 返回 `FrameworkPlan`，前端只合并理由、覆盖度和布局（章节为空时整份采用）。
3. 生成：浏览器调用 `orchestrate.generateContent`：按框架展开页面 → 从正文前 18 万字符切证据片段 → 生成文档节选（36,000 / 8,000 字符）→ 每 4 页一批调用 `POST /api/generate-content/batch` → 汇总并计算高亮和缺失项 → 得到 `AnalyzerResult`，记录生成时的框架摘要。
4. 配图：图片文件按 `page-{页码}-slot-{序号}` 存在浏览器内存。
5. 审阅：编辑直接改 `AnalyzerResult.slidePlan` 中对应页。
6. 导出：把已导入图片转成 ArrayBuffer，与 `slidePlan` 一起交给渲染器，得到 Blob 后下载。

单批的处理（Worker）：用完整节选拼提示词调用 Gemini（失败时改用精简节选再试）→ 正文为空的页重写一次 → 仍缺的页用证据片段补写。全部调用失败时整批按规则补写，返回 `ok: false`。

## 6. 状态归属

| 状态 | 位置 | 生命周期 |
|---|---|---|
| 流程数据、图片文件、生成结果、导出 Blob | React state（`useWorkflow`） | 当前标签页；刷新即丢失 |
| Access 登录会话 | Cloudflare Access cookie | 按 Access 应用的会话时长 |
| 服务器端 | 无 | Worker 不保存请求和结果 |

## 7. 接口与集成点

- 前后端 HTTP 接口：`docs/API.md`。
- Gemini：`POST {GEMINI_BASE_URL}/models/{model}:generateContent`，Key 放在 `x-goog-api-key` 请求头，`responseMimeType: application/json`，`temperature: 0.2`。
- Cloudflare Access：Worker 从 `{ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` 取公钥校验 JWT。
- ITEI DRAW：只是外链，无数据交换。

## 8. 持久化

无。没有数据库表结构和迁移，不单独写 DATA_MODEL。

## 9. 错误处理

- 后端错误统一为 `{ error: { code, message, details? } }`，状态码见 API.md。
- 规划：Gemini 失败（缺 Key 除外）时用本地规则兜底，`apiPlanMeta.provider` 带 `:fallback` 后缀。
- 生成：批次失败、接近软时限时补写正文，`generationMeta.mode = 'degraded'`，`reason` 列出原因。批次请求本身失败（网络、401、503 等）时整次生成中止，界面显示原因和“重新生成”。
- 前端把错误码映射成中文提示（`mapPlanErrorToMessage`、`mapGenerateContentError`、`getUploadErrorInfo`）。

## 10. 外部依赖

Gemini API；Cloudflare Workers（含 Static Assets）、Cloudflare Access；浏览器端 pdfjs-dist、mammoth、PptxGenJS。

## 11. 可观测性

- Worker 开启 Workers Logs，记录请求路径和状态码。
- 浏览器端 orchestrator 用 `console.info('[generate-content][completeness]', …)` 记录每次生成的缺页、补写、降级原因和耗时（只在用户浏览器控制台）。
- 前端只有上传日志区和错误提示，没有埋点。

## 12. 部署与运行形态

| 环境 | 前端 | 后端 |
|---|---|---|
| 本地 | Vite 开发服务 `:3000`，`/api` 代理到 `:8787` | `worker/src/dev/localServer.ts`（tsx，不校验 Access） |
| 本机 Cloudflare 运行时 | `wrangler dev` 提供 `src/dist` | 同一个 Worker，由 `npm run smoke:workerd` 驱动 |
| 线上 | Worker 静态资源（`src/dist`） | Worker `iteislides`，自定义域名 `slides.sensor-cloud.org`，Access 保护，Workers 免费版 |

部署步骤见 `docs/cloudflare-deployment.md`。

## 13. 技术约束

- 免费版每次请求 CPU 10 ms（等待网络不计入）：实测单批约 1～2 ms，规划约 1 ms。
- 请求体：`/api/plan` 2 MB，`/api/generate-content/batch` 256 KB。规划取正文前 12 万字符，生成取前 18 万字符，提示词内正文最多 3.6 万字符（精简版 8000）。
- 生成每批 4 页；单次 Gemini 调用最多试 2 次，只重试 408、429、5xx 和 JSON 解析失败。每批最多 6 次 Gemini 调用，低于免费版每请求 50 次外部请求的上限。
- 生成软时限 500 秒，留 20 秒余量；浏览器每批最长等 5 分钟。
- 模板目录页只有 6 行，导出最多支持 6 个章节。

## 14. 已知限制

- “目标页数”未被使用（PRD Q-1）。
- Key 无效时规划和生成静默降级为本地规则，界面看不出是 Key 的问题（PRD Q-10）。
- 超过 6 个章节导出失败（PRD Q-2）。
- SVG、WEBP 图片不转换格式（PRD Q-4）。
- 后端提示词有 5 处乱码（PRD Q-5）。
- 浏览器刷新会丢失已解析文档、框架和已导入图片；生成期间刷新或关闭页面，生成立即停止（PRD Q-7）。
- E2E 默认跑生产构建（`vite build` + `vite preview`），与用户拿到的一致；`E2E_DEV=1 npm run e2e:local` 在开发服务器（StrictMode）上跑本地全流程。

## 15. 相关决策

- `docs/decisions/ADR-001-single-backend.md`
- `docs/decisions/ADR-002-no-agent-runtime.md`
- `docs/decisions/ADR-003-stack-alignment.md`
- `docs/decisions/ADR-004-cloudflare-worker.md`
