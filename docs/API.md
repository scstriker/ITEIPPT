# 接口规格：ITEISlides 后端 HTTP API

## 1. 范围

浏览器与后端之间的 HTTP 接口。线上由 Cloudflare Worker 提供（与前端同源，`wrangler.jsonc` 让 `/api/*` 先进入 Worker）；本地由 `worker/src/dev/localServer.ts` 提供（经 Vite 代理）。两者运行同一个 fetch 处理函数 `worker/src/http/app.ts`。类型定义在 `worker/src/contracts/` 和 `worker/src/content/types.ts`。

## 2. 约定

- 请求和响应都是 JSON。
- 错误响应统一为：

  ```json
  { "error": { "code": "missing_api_key", "message": "…", "details": "…" } }
  ```

  `details` 可选，内容是上游原始信息的截断，只用于排查。
- `code` 是稳定字段，前端按它映射中文提示；`message` 不保证稳定。
- 所有响应带 `cache-control: no-store` 和 `x-content-type-options: nosniff`。

## 3. 认证与授权

除 `GET /api/health` 外，线上每个请求都要带 Cloudflare Access 签发的 JWT（Access 在边缘自动加上 `Cf-Access-Jwt-Assertion` 请求头）。规则见 `docs/SECURITY.md` 第 3 节。

| 状态 | code | 条件 |
|---|---|---|
| 401 | `access_denied` | 缺令牌、签名不对、`aud`/`iss` 不符或已过期 |
| 503 | `access_not_configured` | Worker 未配置 `ACCESS_TEAM_DOMAIN` 或 `ACCESS_AUD` |
| 503 | `access_unavailable` | 取不到 Access 团队公钥 |

本地开发服务器不做这项检查。Gemini Key 只在服务端使用。

## 4. 接口

### GET /api/health

**用途：** 健康检查，不调用 Gemini，也不检查 Access。

**输出：** `200 { "ok": true, "service": "iteislides-api" }`

### POST /api/plan

**用途：** 评估章节与文档的匹配度，决定每个子章节的布局。`blank` 不足 6 章或每章不足 2 个子章节时，先用固定章节补齐。

**输入：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `presetId` | `standard_review` \| `academic_research` \| `blank` | 必填 |
| `textContent` | string | 必填，去掉首尾空白后不能为空。后端只用前 12 万字符；浏览器只发送前 15 万字符 |
| `chapters` | `{ chapterIndex, chapterTitle, slides: { subtitle, visualMode, contentHint? }[] }[]` | 可选。缺省或无有效章节时用后端预设 |

**输出：** `200 FrameworkPlan`。`chapters[].aiReason`、`coverageLevel`、`sourceHint` 和 `slides[].visualMode` 已更新；`apiPlanMeta` 含 `provider`（降级时带 `:fallback`）、`recommendedAt`、`chapterInsights[]`、`slideInsights[]`。

**错误：**

| 状态 | code | 条件 |
|---|---|---|
| 400 | `invalid_json` | 请求体不是 JSON |
| 400 | `invalid_preset` | `presetId` 不在 3 个取值内 |
| 400 | `missing_text_content` | `textContent` 为空 |
| 413 | `payload_too_large` | 请求体超过 2 MB |
| 503 | `missing_api_key` | 服务端未配置 Key |
| 502 | `plan_generation_failed` | 其他未处理异常 |

Gemini 调用失败（缺 Key 除外）不报错，返回本地规则生成的结果。**副作用：** 无。

### POST /api/generate-content/batch

**用途：** 为一批（1～4 张）正文页生成内容。浏览器用 `worker/src/content/orchestrate.ts` 把全部正文页分批，依次调用本接口，再在本地组装 `AnalyzerResult`。

**输入（`ContentBatchRequest`）：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `presetId` | 同上 | 必填 |
| `contexts` | `SlideEvidenceContext[]` | 1～4 项，页码不重复。每项含 `page`、`chapterIndex`、`slideIndex`、`chapterTitle`、`subtitle`、`visualMode`、`contentHint?`、`sourceHint?`、`evidenceSnippets`（≤5 条，每条 ≤400 字符）、`primarySourceRef`、`evidenceKeywords` |
| `excerpts` | `{ full: { text, truncated }, compact: { text, truncated } }` | 文档节选：`full` 不超过 36,000 字符，`compact` 不超过 8,000 字符（各加分隔符） |

**处理：** Worker 用 `full` 节选拼提示词调用 Gemini；失败再用 `compact` 节选重试；正文为空的页面再请 Gemini 改写一次；仍缺的页面从原文片段补写。

**输出（`ContentBatchResult`）：** `200 { ok, slides[], weakPages[], fallbackPages[], diagnostics, error? }`。`ok = false` 表示这批的 Gemini 调用全部失败，页面已按规则补写（`fallbackPages`），浏览器据此把结果标为降级（`batch_generation_failed`）。

**错误：**

| 状态 | code | 条件 |
|---|---|---|
| 400 | `invalid_json` | 请求体不是 JSON |
| 400 | `invalid_preset` | `presetId` 不在 3 个取值内 |
| 400 | `invalid_batch_request` | 结构、类型或长度不合规，`details` 说明哪个字段 |
| 413 | `payload_too_large` | 请求体超过 256 KB |
| 503 | `missing_api_key` | 服务端未配置 Key |
| 502 | `content_generation_failed` | 其他未处理异常 |

**副作用：** 无。服务器不保存请求和结果。

### 其他 /api/* 路径

返回 `404 { "error": { "code": "not_found", … } }`，包括已删除的 `POST /api/generate-content`、`/api/generate-content/jobs` 系列，以及重构前的 Gemini 透传路径。

## 5. 限制

- 请求体：`/api/plan` 2 MB，`/api/generate-content/batch` 256 KB。
- 每次请求的 CPU 时间在 Cloudflare 免费版的 10 ms 以内（等待 Gemini 不计入）；请求时长不设上限。
- 浏览器端：每批最长等待 5 分钟；整次生成软时限约 8 分钟（`CONTENT_SOFT_DEADLINE_MS` 500 秒减 20 秒保护），超时后剩余页面按规则补写。

## 6. 参考

- 类型：`worker/src/contracts/`、`worker/src/content/types.ts`
- 前端客户端：`src/services/api/`
- 合同测试：`worker/tests/`；运行时冒烟：`worker/scripts/workerdSmoke.ts`
