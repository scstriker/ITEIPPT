# ITEISlides 部署手册（Cloudflare）

更新时间：2026-10-25。系统部署为一个 Cloudflare Worker：静态页面来自 `src/dist`，`/api/*` 由 `worker/src/index.ts` 处理，`slides.sensor-cloud.org` 由 Cloudflare Access 保护。不使用 Firebase；旧的 Firebase 部署文档在 `archive/dev-history/cloud-deployment-firebase.md`。

## 1. 组成

| 组件 | 说明 |
|---|---|
| Worker `iteislides` | 配置在 `worker/wrangler.jsonc`。静态资源用 Workers Static Assets，单页应用回退；只有 `/api/*` 先进入 Worker |
| 自定义域名 `slides.sensor-cloud.org` | Worker Custom Domain，DNS 记录和证书由 Cloudflare 自动创建 |
| Cloudflare Access 应用 | 覆盖整个 `slides.sensor-cloud.org`，只允许名单内的邮箱登录 |
| Secret `GEMINI_API_KEY` | 只在 Worker 中可读 |
| 变量 | `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`GEMINI_PLAN_MODEL`、`GEMINI_CONTENT_MODEL`（可选 `GEMINI_BASE_URL`） |

套餐：Workers 免费版即可。每次接口请求的 CPU 时间约 1～2 ms，内容生成由浏览器逐批调用，见 `docs/decisions/ADR-004-cloudflare-worker.md`。免费版每天 10 万次请求。

## 2. 首次部署

需要 Node.js 22，在仓库根目录执行过 `npm install --prefix worker` 和 `npm install --prefix src`。`wrangler` 已作为 `worker/` 的开发依赖安装，用 `npx wrangler login` 登录 Cloudflare。

### 2.1 准备 Gemini Key

1. 在 Google AI Studio 新建一个 Key。旧 Key 一律作废，不要复用。
2. 在 Google Cloud 控制台的“凭据”页，把这个 Key 的 API 限制设为只允许 Generative Language API。
3. 为所在项目设置配额上限或预算告警。

### 2.2 建 Cloudflare Access 应用

控制台菜单名称可能调整，以 Cloudflare Zero Trust 文档为准。

1. 进入 Cloudflare 控制台的 Zero Trust，选 Access 下的 Applications，新增一个 Self-hosted 应用。
2. 应用域名填 `slides.sensor-cloud.org`，路径留空（保护整个站点）。
3. 登录方式选 One-time PIN（邮箱验证码）。
4. 新增策略：动作 Allow，Include 选 Emails，填允许使用的邮箱；全单位使用时选 Emails ending in，填单位邮箱后缀。
5. 保存后，在应用详情里复制 Application Audience (AUD) Tag；在 Zero Trust 设置里查看团队域名（形如 `xxx.cloudflareaccess.com`）。
6. 把两个值填进 `worker/wrangler.jsonc` 的 `ACCESS_AUD` 和 `ACCESS_TEAM_DOMAIN`。它们不是秘密，可以提交。

### 2.3 腾出域名

`slides.sensor-cloud.org` 原来是指向 Firebase 的 CNAME 记录。Worker 自定义域名要求这个名字上没有别的记录：在 Cloudflare 控制台 `sensor-cloud.org` 的 DNS 页面删除 `slides` 的 CNAME 记录和 `_acme-challenge.slides` 的 TXT 记录。

### 2.4 写入 Key 并部署

在 `worker/` 目录执行：

```powershell
npx wrangler secret put GEMINI_API_KEY
```

按提示粘贴 Key 后回车。Key 只在这一步出现，不要写进任何文件。然后部署：

```powershell
npm run deploy
```

这条命令先构建前端（`src/dist`），再执行 `wrangler deploy`。第一次部署会创建 Worker、自定义域名的 DNS 记录和证书。

## 3. 部署后自检

```powershell
curl.exe -s https://slides.sensor-cloud.org/api/health
```

- 没登录时，Access 拦截请求，返回登录页或 302，这说明 Access 生效。
- 在浏览器中用名单内的邮箱登录后打开 `/api/health`，返回 `{"ok":true,"service":"iteislides-api"}`。
- 用不在名单内的邮箱登录，应被拒绝。
- 登录后用示例文档走完 4 步，确认 AI 建议调整的理由不是“已基于章节标题……生成默认分析……”（否则 Key 无效），并能导出 PPTX。
- 在 Cloudflare 控制台确认 Worker 的 workers.dev 地址处于关闭状态。

## 4. 日常更新

1. 在 `worker/` 运行 `npm test`，在 `src/` 运行 `npm test` 和 `npm run e2e`。
2. 在 `worker/` 运行 `npm run smoke:workerd`，在本机的 Cloudflare 运行时中检查 Access 校验和两个接口。
3. 在 `worker/` 运行 `npm run deploy`。

更换 Key：重新执行 `npx wrangler secret put GEMINI_API_KEY`，Worker 自动使用新值。

回滚：`npx wrangler deployments list` 查看历史版本，`npx wrangler rollback <版本 ID>` 回到指定版本。

## 5. 停用旧的 Firebase 部署

旧项目 `iteippt-cloud-260412-4205` 的结算已关闭，`/api/*` 返回 503。确认新部署可用后：

1. 在 Google AI Studio 删除旧项目使用的 Gemini Key。
2. 在 Firebase 控制台删除 3 个函数、Secret Manager 中的 `GEMINI_API_KEY` 和任务存储桶，或者直接关闭整个项目。
