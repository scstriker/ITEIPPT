# 接口规格：ITEISlides 后端 HTTP API

## 1. 范围

前端与后端之间的 HTTP 接口。本地由 `functions/src/dev/localServer.ts` 提供（经 Vite 代理），线上由 Firebase 函数 `api` 提供（经 Hosting rewrite，与前端同源）。类型定义在 `functions/src/contracts/`。

## 2. 约定

- 请求和响应都是 JSON，请求体上限 8 MB。
- 错误响应统一为：

  ```json
  { "error": { "code": "missing_api_key", "message": "…", "details": "…" } }
  ```

  `details` 可选，内容是上游原始信息的截断，只用于排查。
- `code` 是稳定字段，前端按它映射中文提示；`message` 为英文或中文说明，不保证稳定。

## 3. 认证与授权

接口不做用户认证。Gemini Key 只在服务端使用，前端不传、不接触 Key。限制见 `docs/SECURITY.md`。

## 4. 接口

### GET /api/health

**用途：** 健康检查。

**输出：** `200 { "ok": true, "service": "local-gemini-proxy" }`

### POST /api/plan

**用途：** 评估章节与文档的匹配度，决定每个子章节的布局。`blank` 不足 6 章或每章不足 2 个子章节时，先用固定章节补齐。

**输入：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `presetId` | `standard_review` \| `academic_research` \| `blank` | 必填 |
| `textContent` | string | 必填，去掉首尾空白后不能为空 |
| `chapters` | `{ chapterIndex, chapterTitle, slides: { subtitle, visualMode, contentHint? }[] }[]` | 可选。缺省或无有效章节时用后端预设 |

**输出：** `200 FrameworkPlan`。`chapters[].aiReason`、`coverageLevel`、`sourceHint` 和 `slides[].visualMode` 已更新；`apiPlanMeta` 含 `provider`（降级时带 `:fallback`）、`recommendedAt`、`chapterInsights[]`、`slideInsights[]`。`presetId = blank` 时保证至少 6 章、每章至少 2 个子章节。

**错误：**

| 状态 | code | 条件 |
|---|---|---|
| 400 | `invalid_preset` | `presetId` 不在 3 个取值内 |
| 400 | `missing_text_content` | `textContent` 为空 |
| 503 | `missing_api_key` | 服务端未配置 Key |
| 502 | `plan_generation_failed` | 其他未处理异常 |

Gemini 调用失败（缺 Key 除外）不报错，返回本地规则生成的结果。

**副作用：** 无。**幂等：** 否（AI 输出不确定）。

### POST /api/generate-content/jobs

**用途：** 创建异步生成任务。

**输入：** `{ frameworkPlan: FrameworkPlan, textContent: string, sourceFilename?: string }`

**输出：** `202 { jobId, status: "queued", createdAt, pollUrl, resultUrl }`

**错误：**

| 状态 | code | 条件 |
|---|---|---|
| 400 | `invalid_framework_plan` | `frameworkPlan` 缺 `presetId`（3 个取值之一）或 `chapters` 数组 |
| 400 | `missing_text_content` | `textContent` 为空 |
| 503 | `missing_api_key` | 服务端未配置 Key |
| 502 | `generation_job_create_failed` | 存储或入队失败（入队失败时任务标记为 `failed`，code `job_enqueue_failed`） |

**副作用：** 写入任务记录和请求体，触发执行。

### GET /api/generate-content/jobs/:jobId

**用途：** 查询任务状态。

**输出：** `200 { jobId, status, progress: { percent, stage, processedBatches, totalBatches }, error?, createdAt, updatedAt, resultReady }`。`status` 取 `queued`、`running`、`succeeded`、`failed`；`stage` 是中文阶段文字（如“正在生成内容（批次 2/5）”）。

**错误：** 400 `invalid_job_id`；404 `generation_job_not_found`；500 `generation_job_status_failed`。

### GET /api/generate-content/jobs/:jobId/result

**用途：** 取成功任务的结果。

**输出：** `200 AnalyzerResult`。

**错误：** 400 `invalid_job_id`；404 `generation_job_not_found`；409 `job_not_completed`；500 `generation_job_result_failed`。

### POST /api/generate-content

**用途：** 同步生成。前端已改用任务接口，此接口保留给旧调用方。

**输入：** 同 `POST /api/generate-content/jobs`。

**输出：** `200 AnalyzerResult`。生成整体失败时返回整份降级结果（`generationMeta.mode = "degraded"`，`reason` 以 `request_level_fallback:` 开头）。

**错误：** 400 `invalid_framework_plan`、`missing_text_content`；503 `missing_api_key`；502 `content_generation_failed`（无法构造降级结果时）。

### 其他 /api/* 路径

返回 `404 { "error": { "code": "not_found", … } }`。

**兼容性说明：** 重构前，其他 `/api/*` 路径会带上服务器 Key 透传到 Gemini（缺 Key 时 503，路径为空时 400 `invalid_api_path`）。此行为已删除，前端从未使用。

## 5. 限制

- 请求体 8 MB。
- 生成软时限 500 秒；线上函数 `api` 超时 600 秒，worker 540 秒。
- 任务保留 72 小时。

## 6. 参考

- 类型：`functions/src/contracts/analyzer.ts`、`framework.ts`、`template.ts`
- 前端客户端：`src/services/api/`
- 合同测试：`functions/tests/`
