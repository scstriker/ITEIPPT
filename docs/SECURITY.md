# 安全规格：ITEISlides

2026-10-25 起，系统部署在 Cloudflare（Worker + 静态资源），不再使用 Firebase。架构决策见 `docs/decisions/ADR-004-cloudflare-worker.md`。

## 1. 范围与信任边界

| 边界 | 说明 |
|---|---|
| 访问者 → `slides.sensor-cloud.org` | 不可信。Cloudflare Access 在边缘拦截，只有名单内的邮箱通过一次性验证码登录后才能打开页面和调用接口 |
| Access → Worker `/api/*` | Worker 再次校验 Access 签发的 JWT（`Cf-Access-Jwt-Assertion`），不信任边缘配置一定正确 |
| Worker → Gemini | Worker 持有 Key，代表本所调用 Google |
| 浏览器内部 | 原文件、图片、生成结果和 PPTX 只在浏览器中处理 |

## 2. 需要保护的资产

- Gemini API Key（按调用计费）。此前使用的 Key 曾被盗用。
- 用户上传文档的文字（送审稿等，可能未公开）。

## 3. 认证

- 使用 Cloudflare Access（Zero Trust），应用覆盖 `slides.sensor-cloud.org` 全站，策略为“允许名单内的邮箱”，登录方式为邮箱一次性验证码。配置步骤见 `docs/cloudflare-deployment.md`。
- Worker 对除 `/api/health` 以外的全部接口校验 Access JWT：RS256 签名（团队公钥，缓存 10 分钟）、`aud` 等于应用的 AUD 标签、`iss` 等于团队域名、`exp`/`nbf`（允许 60 秒时钟偏差）。不通过返回 `401 access_denied`。
- 失败即关闭：`ACCESS_TEAM_DOMAIN` 或 `ACCESS_AUD` 未配置时，接口一律返回 `503 access_not_configured`。部署配置中没有关闭校验的开关；只有本机开发服务器（只监听 127.0.0.1）不校验。
- `workers_dev` 和 `preview_urls` 关闭，Worker 只能通过受 Access 保护的自定义域名访问。

## 4. 授权

- 通过认证的用户都可以使用全部功能，没有角色区分。
- Worker 只暴露 `docs/API.md` 列出的 3 个接口，其余 `/api/*` 返回 404（AC-027）。重构前的 `/api/*` 透传（带服务器 Key 转发任意请求到 Gemini）已删除，它是此前 Key 被滥用的最可能原因。
- 提示词由 Worker 拼装，浏览器只能提交固定结构的数据（框架、页面线索、文档节选），不能指定模型、参数或任意提示词。

## 5. 密钥与凭据

- 线上：Worker Secret `GEMINI_API_KEY`，由管理员在自己的终端执行 `npx wrangler secret put GEMINI_API_KEY` 输入。Secret 加密保存，`wrangler.jsonc`、代码仓库和构建产物中都没有 Key（AC-030）。
- 本地：`src/.env` 的 `GEMINI_API_KEY`，由本地开发服务器读取。`.env`、`.dev.vars` 已被 `.gitignore` 排除。
- Key 只放在发往 Gemini 的 `x-goog-api-key` 请求头中，不出现在 URL、日志和错误信息里。
- 建议：使用新 Key；在 Google Cloud 控制台把 Key 的 API 限制设为只允许 Generative Language API；设置配额上限和预算告警；怀疑泄露时立即在 Google AI Studio 删除旧 Key 并重新执行 `wrangler secret put`。
- `archive/dev-history/notes_utf8.md` 和 `src/.env` 中的旧 Key 只在本机，未进入 git 历史（2026-10-25 扫描全部提交确认）。这些 Key 应视为已泄露并作废。

## 6. 不可信输入

- 上传文件只在浏览器内解析（pdfjs、mammoth），不上传原文件。限制：单个文件、`.pdf` / `.docx`、20 MB、45 秒超时。
- 图片只在浏览器内使用，限 `image/*`、12 MB。
- `/api/plan`：请求体不超过 2 MB；校验 `presetId` 和 `textContent`；正文按 12 万字符截断（浏览器只发送前 15 万字符）。
- `/api/generate-content/batch`：请求体不超过 256 KB；按字段校验结构、类型和长度（每批 1～4 页，页码不重复，节选不超过 36,000 / 8,000 字符等）。不合格返回 400，不调用 Gemini。
- Gemini 返回内容按 JSON 解析并逐字段规整（类型、取值范围、长度），不执行任何返回内容。

## 7. 文件系统、远程执行与工具边界

Worker 不读写文件，不执行命令，不调用工具，除 Gemini 和 Access 公钥地址外不访问其他网络地址。

## 8. 敏感数据

- 文档文字会发送给 Gemini（数据出境到 Google）：规划时最多 12 万字符；生成时每批带不超过 36,000 字符的节选和每页的原文片段。涉密或未公开文档不应使用本系统，手册已写明。
- 服务器端不保存文档文字、框架和生成结果。重构前线上保存 72 小时的任务记录已随 Firebase 一起取消。
- 汇报人、所属机构等封面信息不发送到服务器。

## 9. 日志与脱敏

- Worker 开启 Cloudflare Workers Logs（`observability`），记录请求路径、状态码和 `console` 输出。Worker 不打印请求体、正文或 Key。
- 错误 `details` 可能包含 Gemini 返回的错误原文（截断到 320 字符），不含 Key。

## 10. 可审计性

Cloudflare Access 记录每次登录（邮箱、时间、IP），可在 Zero Trust 控制台的日志中查看。Worker 日志按 Cloudflare 的保留期保存。

## 11. 安全相关的失败模式

- Access 未配置：接口 503 `access_not_configured`，页面能打开但 AI 功能不可用。
- Access 令牌无效或过期：接口 401 `access_denied`，页面提示刷新后重新登录。
- 缺 Key：接口 503 `missing_api_key`，不降级。
- Gemini 失败或 Key 无效：规划和生成降级为本地规则，结果中标明（PRD Q-10）。

## 12. 已知风险与接受的取舍

| 风险 | 现状 | 建议 |
|---|---|---|
| 名单内用户可以无限次调用 AI | 接受（内部工具，人数少） | Google 侧设置配额和预算告警；需要时在 Worker 加按邮箱限流 |
| 文档出境到 Google | 接受 | 手册写明适用范围 |
| 开发依赖中 wrangler（undici）、vitest（vite）有 npm audit 告警 | 只在开发机使用，不进入部署包 | 跟随上游版本升级 |
| Cloudflare Access 策略配置错误 | Worker 自身校验 JWT，错误配置只会导致拒绝访问 | 每次改策略后用未授权邮箱验证一次 |
