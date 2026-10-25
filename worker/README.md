# ITEISlides 后端（Firebase Functions）

前端 `src/` 调用的全部 `/api/*` 接口都在这里实现。线上运行在 Firebase Functions Gen2（`asia-east1`），本地用 `src/dev/localServer.ts` 运行同一套代码。接口契约见 `docs/API.md`。

## 目录

| 路径 | 内容 |
|---|---|
| `src/index.ts` | Firebase 触发器：`api`（HTTP）、`generationJobWorker`（Pub/Sub）、`generationJobCleanup`（每 24 小时） |
| `src/http/` | Express 应用 `createApiApp` 与错误响应 |
| `src/plan/` | `/api/plan`：预设、自定义模板补齐、AI 洞察与本地降级 |
| `src/content/` | 逐页内容生成：证据、提示词、高亮、补写、组装 |
| `src/gemini/` | Gemini REST 调用、JSON 提取、重试 |
| `src/jobs/` | `JobStore` / `JobRunner` 接口；Firestore + Storage 实现、内存实现；Pub/Sub 与进程内执行器；worker |
| `src/contracts/` | 前后端共享类型（前端经 `@contracts/*` 引用） |
| `src/dev/localServer.ts` | 本地入口（不参与部署构建） |
| `tests/` | Vitest：接口合同、规划、任务、worker、生成快照。Gemini 由 `tests/helpers/geminiStub.ts` 模拟 |

## 本地运行

在 `src/` 下执行（读取 `src/.env` 中的 `GEMINI_API_KEY`，监听 `127.0.0.1:8787`）：

```bash
npm run proxy:dev
```

任务存在内存里，进程退出即丢失。

## 测试

```bash
npm test
```

```bash
npm run typecheck
```

## 配置

- Secret：`GEMINI_API_KEY`（`firebase functions:secrets:set GEMINI_API_KEY`）
- 环境变量（`functions/.env`）：`GEMINI_BASE_URL`、`GEMINI_PLAN_MODEL`、`GEMINI_CONTENT_MODEL`、`GENERATION_JOB_BUCKET`（必填）、`GENERATION_JOB_TOPIC`（可选，默认 `iteippt-generation-content-jobs`）

## 构建与部署

```bash
npm run build
```

部署步骤和上线后的自检见 `docs/cloud-deployment.md`。
