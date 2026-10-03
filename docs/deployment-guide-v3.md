# ITEIPPT v2.0 运维部署手册（V3版 - 全栈直连版）

> **文档受众**：SRE、运维工程师、发布专员
> **目标环境**：Google AI Studio 推荐架构（全栈 Serverless：Firebase Hosting + Functions + Storage）
> **项目现状适配**：本版本已整合 V1 的全栈命令与 V2 的工程结构事实（如前端代码位于 `src/`，构建产物对应为 `src/dist`），请严格依据此标准执行 CD 流程。

---

## 1. 生产级架构拓扑

采用去 OAuth 化、直接 API 路由分发的无服务器全栈架构：

```text
[ 终端用户 ] (浏览器)
     │
     │ ① 静态资源请求 / SPA 单页路由
     ▼
[ Firebase Hosting ] ───────── (前端构建产物：src/dist/*)
     │
     │ ② 以 /api/* 开头的请求 (firebase.json rewrites)
     ▼
[ Firebase Functions ] ─────── (Node.js 20 Serverless)
     │   ├── POST /api/plan (框架推荐)
     │   ├── POST /api/generate-content (内容生成, SSE流式)
     │   └── 提供底层 CORS 与机密管理
     │
     │ ③ 内部调用 (携带底层解密的 GEMINI_API_KEY)
     ▼
[ Gemini API 官方节点 ] ────── (Google AI Studio)

     │ ④ 生成产物归档 (Bypass API)
     ▼
[ Firebase Storage ] ───────── (PPTX版本历史 bucket)
```

---

## 2. 准入前置条件 (Prerequisites)

| 组件 | 要求 | 验证指令 |
| :--- | :--- | :--- |
| **Node.js** | `>= 20.0.0` | `node -v` |
| **包管理器** | `npm` 或 `pnpm` | `npm -v` |
| **CLI 工具** | Firebase CLI | `firebase --version` (若无则 `npm i -g firebase-tools`) |
| **云端依赖** | 已开通的 Firebase 项目 | `firebase projects:list` |
| **付费计划** | **Blaze (即用即付)** | [Firebase 控制台核验] Functions 强依赖此级别 |
| **机密凭证** | Gemini API Key | 从 [Google AI Studio](https://aistudio.google.com) 获取 |

---

## 3. 环境变量与安全密钥注入

为了彻底杜绝 API Key 构建泄露到前端大包，本架构实施 **“仅后端解密”** 策略。

### 3.1 Firebase Secrets 注入（云端）
对于云端部署，使用 Google Cloud Secret Manager 机制：

```bash
# 设定密钥（如果这是第一次，终端会要求粘贴真实 Key 值）
firebase functions:secrets:set GEMINI_API_KEY

# 日常校验是否注入成功（不显示明文）
firebase functions:secrets:access GEMINI_API_KEY
```

### 3.2 环境变量定义清单

- **Functions 层** 需要读取（通过 SecretManager）：`GEMINI_API_KEY`
- **Frontend 层** 需要读取（位于 `src/.env`）：`VITE_APP_TITLE` 等纯量，**绝对不可包含** `API_KEY`。前端所有的请求目标由 Relative Path (`/api/...`) 和 Firebase Hosting Rewrite 接管。

---

## 4. 初始化与配置合规校验

初次拉取代码或在新机器上接手项目，必须确认核心 Firebase 配置。项目根目录下存在以下红线配置文件：

### 4.1 `firebase.json` (路由白名单配置)
核心核对内容：`public` 必须指向 `src/dist`；必须有 `/api/**` 到 `api` 函数的反向代理 rewrite 规则。

```json
{
  "hosting": {
    "public": "src/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "/api/**", "function": "api" },
      { "source": "**", "destination": "/index.html" }
    ]
  },
  "functions": { "source": "functions", "runtime": "nodejs20" },
  "storage": { "rules": "storage.rules" }
}
```

### 4.2 `storage.rules` (安全桶策略)
因为没有接入标准的 OAuth 身份验证，暂定 bucket 读写开放（仅内网业务人员暴露链接）：

```text
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /pptx-versions/{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

---

## 5. 打包构建流水线 (Pipeline Actions)

请在 CI/CD 服务器或发布操作机上严格顺序执行：

### Step 5.1 依赖对齐与质量门禁
```bash
# 1. 切入前端目录构建 SPA 产物
cd src
npm ci
npm run lint         # 门禁 1：代码质量校验
npm run build        # 门禁 2：Vite 闭包打包，输出至 src/dist/

# 2. 切入云函数目录构建 Node 产物
cd ../functions
npm ci
npm run build        # 输出 tsc 编译产物
cd ..
```

### Step 5.2 综合健康度探测 (Smoke Test)
(可选，推荐本地执行以保证质量)
```bash
cd src
npm run proxy:smoke
npm run gate:phase1
cd ..
```

---

## 6. 全量 / 增量割接部署

### 全量一次性推送 (大版本/全栈更新)
```bash
firebase deploy
# 预计耗时：1-3分钟。
# 执行动作：推送 Storage 规则 -> 构建/上传压缩 Functions 镜像 -> 上传 Hosting 静态文件。
```

### 热更新与增量覆盖 (日常发版)

**场景 A：仅更新了 UI 或文案 (SPA变更)**
```bash
cd src && npm run build && cd ..
firebase deploy --only hosting
```

**场景 B：修改了 /api 的 AI 处理逻辑**
```bash
cd functions && npm run build && cd ..
firebase deploy --only functions
```

---

## 7. 运维保障 Runbook (故障速查与止损)

### 7.1 日志聚合监控
生产环境出现 AI 不回包、报错，第一现场为 Functions 日志。

```bash
# 流式挂载生产日志
firebase functions:log --only api

# 捕获异常栈过滤（PowerShell示例）
firebase functions:log | Select-String -Pattern "Error|Exception"
```

### 7.2 秒级安全回滚方案
若新版本前端存在阻断性 Bug：

```bash
# 查看所有发布切片（Channels）历史
firebase hosting:channel:list

# 若采用 Console 回滚：
# Firebase 控制台 -> Hosting -> 版本历史 -> 点击对应版本的选项卡 -> 选择【回滚部署】
```
如果云函数层因为 Gemini API 接口结构剧变崩溃：
1. 本地切回稳定 Tag 的代码。
2. 重新编译：`cd functions && npm run build && cd ..`
3. 强刷底层覆盖：`firebase deploy --only functions`。

### 7.3 常见环境疑难杂症

| 系统表现 | Rca(根因预判) | 阻断恢复/运维建议 |
| :--- | :--- | :--- |
| **发布命令报 `No project active`** | CLI 丢失当前上下文 | 执 `firebase projects:list` 查阅可用，执 `firebase use iteippt` (你的projectId) 绑定。 |
| **`/api/xx` 一直被 CORS 跨域拦截** | Firebase 函数内未放行 | 核准 `functions/src/index.ts` 的 `onRequest` 被注入 `{ cors: true }` 属性配置。 |
| **云函数部署报 `Billing account not configured`**| Firebase 被降级或冻结 | 进入 GCP 账单控制台检查信用卡是否逾期，并强制将套餐划回 **Blaze**。 |
| **刚部署上去页面白屏 404**| Hosting 目录结构挂载错位 | 检查 `firebase.json` 的 `public` 是否是 `src/dist`；同时在本地查勘 `src/dist/index.html` 是否真的存在。 |
| **调用 AI 生成一直卡着然后 504**| 代理函数超时 / 大模型被墙 / 超额限流 | 检查 Google Cloud Functions 的最大超时指标（建议通过代码设为 300s 以上：`timeoutSeconds: 300`）。 |
