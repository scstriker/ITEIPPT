# ITEIPPT 云端部署手册（异步 Step2 版本）

更新时间：2026-10-03（重构后）。2026-04-12 的线上部署仍是重构前的代码，按第 5 节重新部署后，第 0 节的变化才生效。

## 0. 重构带来的部署变化

- 后端只有一份代码：`functions/src/`。入口 `index.ts`，HTTP 路由 `http/app.ts`，任务 `jobs/`。前端 `src/` 不再包含后端代码。
- 删除了 `/api/*` 透传 Gemini 的路由。未定义的 `/api/*` 返回 `404 not_found`（见 `docs/SECURITY.md`）。
- `storage.rules` 改为拒绝所有客户端读写。Storage 产品初始化后执行 `firebase deploy --only storage`。任务桶经 Admin SDK 访问，不受影响。
- `functions` 的 `npm run build` 先清空 `lib/` 再编译（TypeScript 7），不会再部署过期文件。
- 部署前先跑测试：`cd functions && npm test`、`cd src && npm test && npm run e2e`。
- 运行时仍是 `nodejs20`，请在 Google Cloud 文档核实该运行时的支持期限，必要时另行升级。

## 1. 部署目标
- 前端部署到 Firebase Hosting（`src/dist`）。
- 后端部署到 Firebase Functions Gen2（`functions/src/index.ts` 导出 3 个函数）。
- Step2 内容生成采用“创建任务 + 后台执行 + 前端轮询”。

## 2. 当前线上架构
Functions（`asia-east1`）：
- `api`：HTTP API（含旧同步接口与新异步接口）
- `generationJobWorker`：Pub/Sub 消费任务并执行生成
- `generationJobCleanup`：Cloud Scheduler 定时清理过期任务（默认 72h）

作业存储：
- Firestore：任务状态与进度（`generationJobs`）
- Cloud Storage（自定义桶）：请求体与结果 JSON（避免 Firestore 文档超大）

前端 Step2：
- `POST /api/generate-content/jobs` 创建任务
- `GET /api/generate-content/jobs/:jobId` 轮询状态
- `GET /api/generate-content/jobs/:jobId/result` 拉取结果
- 任务 ID 记在 `sessionStorage`；“规划框架”重新挂载且框架未变时恢复轮询。刷新页面后框架回到默认，不会恢复（PRD Q-7）

## 3. 关键配置
根目录：
- `.firebaserc` 绑定目标项目
- `firebase.json` rewrite：`/api/** -> function api`

`functions/.env`：
- `GEMINI_BASE_URL`
- `GEMINI_PLAN_MODEL`
- `GEMINI_CONTENT_MODEL`
- `ALLOWED_ORIGINS`（代码未使用；Hosting rewrite 同源，无需 CORS）
- `GENERATION_JOB_BUCKET`（必填，异步任务对象存储桶）

Secret Manager：
- `GEMINI_API_KEY`（必填）

## 4. 前置资源（首次项目初始化）
1. 启用 API：
- `firestore.googleapis.com`
- `pubsub.googleapis.com`
- `cloudscheduler.googleapis.com`
- `storage.googleapis.com`

2. 初始化 Firestore（Native）：
```powershell
gcloud firestore databases create --database='(default)' --location=asia-east1 --type=firestore-native --project <projectId>
```

3. 创建异步任务存储桶（示例）：
```powershell
gcloud storage buckets create gs://<projectId>-gen-jobs-<projectNumber> --location=asia-east1 --project <projectId> --uniform-bucket-level-access
```

4. 写入 `functions/.env`：
```dotenv
GENERATION_JOB_BUCKET="<your-job-bucket-name>"
```

## 5. 部署步骤
先执行预检：
```powershell
powershell -ExecutionPolicy Bypass -File scripts/cloud-preflight.ps1
```

设置 Secret：
```powershell
firebase functions:secrets:set GEMINI_API_KEY --project <projectId>
```

测试与构建：
```powershell
cd functions
npm install
npm test

cd ..\src
npm install
npm test
npm run e2e
npm run build

cd ..\functions
npm install
npm run build
```

部署（推荐）：
```powershell
cd ..
firebase deploy --only functions,hosting --project <projectId>
```

说明：
- 若项目尚未在 Firebase Console 完成 Storage 产品初始化，`--only storage` 会失败；不影响本异步链路（其使用自定义 GCS 桶）。

## 6. 接口验收
1. 创建任务应快速返回 `202`：
- `POST /api/generate-content/jobs`

2. 状态流转应可见：
- `queued -> running -> succeeded`（或 `failed`）

3. 结果接口行为：
- 未完成时：`409 job_not_completed`
- 完成时：返回 `AnalyzerResult`

4. 兼容性：
- 旧接口 `POST /api/generate-content` 仍可用

5. 安全自检（重构后新增）：
```powershell
curl.exe -s https://<host>/api/health
curl.exe -s -X POST https://<host>/api/models -H "content-type: application/json" -d "{}"
```
- 第一条返回 `{"ok":true,...}`。
- 第二条必须返回 `404` 和 `{"error":{"code":"not_found",...}}`，不能出现 Gemini 的模型列表或报错。

6. 在页面上用一份示例文档走完 4 步，确认能生成内容并导出 PPTX。

## 7. 已知限制
- Pub/Sub 触发器最大超时为 `540s`（平台限制），因此 worker 为 `540s`，软截止设为 `500s`。
- HTTP `api` 函数可配置到 `600s`，但 Step2 主流程已改为异步，浏览器不再等待长连接。

## 8. 本项目当前线上地址
- Hosting：`https://iteippt-cloud-260412-4205.web.app`
- API（Cloud Run URL）：`https://api-ab3lacbx2a-de.a.run.app`

## 9. Cloudflare 二级域名绑定（`slides.sensor-cloud.org`）
目标：将 `https://slides.sensor-cloud.org` 绑定到 Firebase Hosting 站点 `iteippt-cloud-260412-4205`。

### 9.1 Firebase 侧创建自定义域
已在 Firebase Hosting 创建：
- `projects/iteippt-cloud-260412-4205/sites/iteippt-cloud-260412-4205/customDomains/slides.sensor-cloud.org`

可用以下命令查看最新 DNS 要求（以实时返回为准）：
```powershell
$token = gcloud auth print-access-token
$headers = @{
  Authorization = "Bearer $token"
  "x-goog-user-project" = "iteippt-cloud-260412-4205"
}
Invoke-RestMethod `
  -Method Get `
  -Headers $headers `
  -Uri "https://firebasehosting.googleapis.com/v1beta1/projects/iteippt-cloud-260412-4205/sites/iteippt-cloud-260412-4205/customDomains/slides.sensor-cloud.org" `
| ConvertTo-Json -Depth 30
```

### 9.2 Cloudflare DNS 需要添加的记录（2026-04-12 当前值）
按当前 Firebase 返回，至少需以下两条：

1) Hosting 指向记录：
- 类型：`CNAME`
- 名称：`slides`
- 内容：`iteippt-cloud-260412-4205.web.app`
- 代理：先设为 **DNS only（灰云）**

2) 证书 ACME 验证记录：
- 类型：`TXT`
- 名称：`_acme-challenge.slides`
- 内容：`hJJDTWPJH7pTBm5bw--KA768ZGZ5KSNY0zXe5kje2dc`
- 代理：**DNS only（灰云）**

说明：
- TXT 挑战值可能变化，若 Firebase 返回新值，以最新值覆盖 Cloudflare 记录。
- 先灰云完成验证，证书 Active 后再改橙云。

### 9.3 验证与切换
1) DNS 生效检查：
```powershell
nslookup -type=CNAME slides.sensor-cloud.org
nslookup -type=TXT _acme-challenge.slides.sensor-cloud.org
```

2) Firebase 状态检查（关键字段）：
- `ownershipState` 期望：`OWNERSHIP_ACTIVE`
- `cert.state` 期望：`CERT_ACTIVE`
- `hostState` 期望：`HOST_ACTIVE`

3) 访问检查：
- `https://slides.sensor-cloud.org`
- `https://slides.sensor-cloud.org/api/health`

4) 可选：验证完成后开启 Cloudflare 代理
- 将 `slides` 的 CNAME 改为 **Proxied（橙云）**
- Cloudflare SSL/TLS 模式：**Full (strict)**

### 9.4 常见问题排查
- Firebase 一直 Pending：
  - 核对 TXT/CNAME 名称和内容是否与 Firebase 最新返回一致；
  - 保持灰云，等待 DNS 传播（通常几分钟到几十分钟）。
- 页面可打开但 `/api/*` 报错：
  - 检查 `firebase.json` rewrite 是否保留 `/api/** -> function api`；
  - Cloudflare SSL 模式必须是 `Full (strict)`，不要用 `Flexible`。
- 证书未激活：
  - 先确认 `_acme-challenge` TXT 可被公网解析，再等待 Firebase 完成签发。




