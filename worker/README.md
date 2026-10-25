# ITEISlides 后端（Cloudflare Worker）

前端 `src/` 调用的全部 `/api/*` 接口都在这里实现。线上是一个 Cloudflare Worker，同时提供前端的静态页面；本地用 `src/dev/localServer.ts` 运行同一个处理函数。接口契约见 `docs/API.md`，部署见 `docs/cloudflare-deployment.md`。

## 目录

| 路径 | 内容 |
|---|---|
| `src/index.ts` | Worker 入口：静态资源转给 `ASSETS`，`/api/*` 交给处理函数；按环境变量装配 Access 校验 |
| `src/http/` | fetch 处理函数 `createApiHandler`、Access JWT 校验、批次请求校验、错误响应 |
| `src/plan/` | `/api/plan`：预设、自定义模板补齐、AI 洞察与本地降级 |
| `src/content/` | 逐页内容生成：`batch.ts`（Worker 中的单批生成）、`orchestrate.ts`（浏览器中的分批调度与组装）、证据、提示词、高亮、补写 |
| `src/gemini/` | Gemini REST 调用、JSON 提取、重试。Key 只放在 `x-goog-api-key` 请求头 |
| `src/contracts/` | 前后端共享类型（前端经 `@contracts/*` 引用，`@worker/*` 引用其余代码） |
| `src/dev/` | 本地开发服务器和 node:http 适配器（不参与部署） |
| `tests/` | Vitest：接口合同、Access 校验、Worker 入口、规划、生成快照。Gemini 由 `tests/helpers/geminiStub.ts` 模拟 |
| `scripts/workerdSmoke.ts` | 在本机 Cloudflare 运行时（workerd）中检查静态资源、Access 校验和两个接口 |
| `wrangler.jsonc` | Worker 配置：自定义域名、静态资源、变量。不含任何密钥 |

## 本地运行

在 `src/` 下执行（读取 `src/.env` 中的 `GEMINI_API_KEY`，只监听 `127.0.0.1:8787`，不做 Access 校验）：

```bash
npm run proxy:dev
```

## 测试

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run smoke:workerd
```

## 部署

```bash
npm run deploy
```

先构建 `src/dist`，再执行 `wrangler deploy`。首次部署前的 Access、DNS 和 Secret 设置见 `docs/cloudflare-deployment.md`。
