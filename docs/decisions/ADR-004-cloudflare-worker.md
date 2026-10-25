# ADR-004 部署改用 Cloudflare Worker，内容生成由浏览器逐批驱动

- 状态：已采纳（2026-10-25）
- 取代：ADR-001 中“线上用 Firestore 任务存储 + Pub/Sub 执行”的部分

## 背景

- 用户不再使用 Firebase：此前的 Gemini Key 被盗用，Firebase 项目的结算已被关闭，线上 `/api/*` 返回 503。
- 用户选择 Cloudflare Workers 免费版、Cloudflare Access 邮箱验证码登录、公开的 GitHub 仓库。
- 免费版每次请求的 CPU 时间上限是 10 ms（等待网络不计入），请求时长不设上限，`waitUntil` 最多延长 30 秒。
- 实测（Node 22，桩 Gemini）：一次完整内容生成（13 张正文页）自身代码约 5～11 ms，规划约 1 ms；其余时间都在等待 Gemini。

## 决策

1. 后端改为一个 Cloudflare Worker，同时用 Workers Static Assets 提供前端页面，`/api/*` 才进入 Worker。删除 Firebase Functions、Firestore、Cloud Storage、Pub/Sub 相关代码和配置，目录 `functions/` 改名为 `worker/`。
2. HTTP 层改为标准 fetch 处理函数（`worker/src/http/app.ts`），不再依赖 Express。Worker、本地开发服务器（node:http 适配）和测试共用它。
3. 内容生成拆成两层：
   - `worker/src/content/batch.ts`（Worker 中运行）：一批 1～4 张正文页的提示词、Gemini 调用、紧凑重试、改写和补写。对应新接口 `POST /api/generate-content/batch`。
   - `worker/src/content/orchestrate.ts`（浏览器中运行）：分批、软时限、进度和最终组装。浏览器通过路径别名 `@worker` 直接复用这份代码。
   原来的异步任务（创建、轮询、取结果、72 小时保存、`sessionStorage` 恢复）全部删除。
4. 安全：Key 作为 Worker Secret；调用 Gemini 时放在 `x-goog-api-key` 请求头；Worker 自行校验 Cloudflare Access JWT，未配置 Access 时拒绝全部接口；关闭 workers.dev 和预览地址；批次请求按字段校验并限制在 256 KB。

## 理由

- 免费版放不下“后台任务”：整次生成的 CPU 接近或超过 10 ms，而队列、Durable Objects 的执行同样受这一上限约束；拆成每批一次请求后，单次请求只有 1～2 ms。
- 服务器不再保存文档文字和结果，减少了需要保护的数据。
- 生成结果与拆分前完全一致：`worker/tests/generate-content.golden.test.ts` 的快照未变。

## 代价

- 生成期间关闭或刷新页面，生成立即停止（以前后端任务会继续执行，但结果同样取不回，见 PRD Q-7）。
- 浏览器需要加载约 20 KB 的内容生成代码。
- 每批一次往返，总耗时与以前相同，都取决于 Gemini。

## 被否决的方案

- 保留异步任务，改用 D1 + Queues：免费版下单次消费者的 CPU 上限同样是 10 ms，长文档有超时风险；还要维护任务表和清理。
- Workers 付费版（每月 5 美元）：可以保留原架构，但用户选择免费版。
- 浏览器直接调用 Gemini：Key 会暴露给浏览器，否决。
