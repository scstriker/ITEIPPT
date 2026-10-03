# 安全规格：ITEISlides

## 1. 范围与信任边界

| 边界 | 说明 |
|---|---|
| 浏览器 → 后端 `/api/*` | 不可信。任何能访问站点的人都能调用，没有用户认证 |
| 后端 → Gemini | 后端持有 Key，代表项目调用 Google |
| 后端 → Firestore / Cloud Storage / Pub/Sub | 通过 Admin SDK，绕过安全规则 |
| 浏览器 → Cloud Storage | 不允许直接访问 |

## 2. 需要保护的资产

- Gemini API Key（按调用计费）。
- 用户上传文档的全文（送审稿等，可能未公开）。
- 生成结果（存 72 小时）。

## 3. 认证

系统没有用户认证。这是现状下的已接受风险，见第 12 节。

## 4. 授权

- 后端只暴露 `docs/API.md` 列出的接口。
- 重构前存在 `/api/*` 透传：任意路径会带上服务器 Key 转发到 Gemini，等于把 Key 的全部权限开放给任何访问者。本次已删除，未知路径返回 404（AC-027）。
- `storage.rules` 重构前对 `pptx-versions/**` 允许任何人读写，代码中没有使用这个路径。本次改为全部拒绝（AC-034）。后端经 Admin SDK 访问任务桶，不受影响。

## 5. 密钥与凭据

- 本地：`src/.env` 的 `GEMINI_API_KEY`，由本地后端读取。`.env` 已被 `.gitignore` 排除。
- 线上：Secret Manager 中的 `GEMINI_API_KEY`，函数运行时注入。`functions/.env` 只放非敏感配置。
- 前端代码和构建产物中不得出现 Key（AC-030）。
- 2026-10-03 基线提交时发现 `docs/notes_utf8.md` 含明文 Key，该文件未提交，已加入 `.gitignore`，现位于 `archive/dev-history/`（未跟踪）。建议在 Google AI Studio 轮换这个 Key。

## 6. 不可信输入

- 上传文件只在浏览器内解析（pdfjs、mammoth），不上传原文件。限制：单个文件、`.pdf` / `.docx`、20 MB、45 秒超时。
- 图片只在浏览器内使用，限 `image/*`、12 MB。
- 后端校验 `presetId`、`frameworkPlan` 结构和 `textContent` 非空，正文按 12 万 / 18 万字符截断，请求体 8 MB。
- Gemini 返回内容按 JSON 解析并逐字段规整（类型、取值范围、长度），不执行任何返回内容。

## 7. 文件系统、远程执行与工具边界

后端不读写本地文件系统（本地内存任务除外），不执行命令，不调用工具。

## 8. 敏感数据

- 文档全文会发送给 Gemini（数据出境到 Google）。涉密或未公开文档不应使用本系统，手册应写明。
- 线上请求体（含文档全文）和结果存 Cloud Storage 72 小时后由定时任务删除。
- 浏览器 `sessionStorage` 只存任务 ID 和框架摘要。

## 9. 日志与脱敏

- 生成日志只记录页码、计数、降级原因和耗时，不记录正文。
- 错误 `details` 可能包含 Gemini 返回的错误原文（截断到 320 字符），不含 Key。Key 在 URL 查询参数中，不写入日志。

## 10. 可审计性

线上任务记录保留 72 小时，含状态、尝试次数、请求摘要（章节数、页数、正文长度、文件名）。没有用户级审计。

## 11. 安全相关的失败模式

- 缺 Key：接口返回 503 `missing_api_key`，不降级。
- Gemini 失败：规划和生成降级为本地规则，结果中标明。
- 任务入队失败：任务标记 `failed`，前端提示重试。

## 12. 已知风险与接受的取舍

| 风险 | 现状 | 建议 |
|---|---|---|
| 接口无认证，任何人可调用 `/api/plan` 和生成接口消耗额度 | 接受（内部工具） | 需要时加 Firebase App Check 或登录 |
| CORS | Hosting rewrite 同源，未加 CORS 中间件；`ALLOWED_ORIGINS` 配置项未使用 | 保持同源部署 |
| 文档出境到 Google | 接受 | 手册写明适用范围 |
| 删除透传和收紧 Storage 规则需要部署才生效 | 本次只改代码 | 用户部署后按 `docs/cloud-deployment.md` 自检 |
