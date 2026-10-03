# ITEIPPT v2.0 部署教程（手把手）

本文档覆盖从零开始将 ITEIPPT v2.0 部署到 Firebase 的完整流程。

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│                    用户浏览器                         │
│           访问 https://your-app.web.app              │
└──────────────┬──────────────────────┬────────────────┘
               │ 静态资源              │ API 请求
               ▼                      ▼
┌──────────────────────┐  ┌───────────────────────────┐
│  Firebase Hosting     │  │  Firebase Functions       │
│  (Vite 构建产物)      │  │  POST /api/plan           │
│  - index.html         │  │  POST /api/generate (SSE) │
│  - JS/CSS/assets      │  │  内置 GEMINI_API_KEY      │
└──────────────────────┘  └──────────┬────────────────┘
                                     │
                           ┌─────────▼─────────┐
                           │  Gemini API        │
                           │  (Google AI)       │
                           └───────────────────┘

┌──────────────────────┐
│  Firebase Storage     │
│  PPTX 版本历史存档    │
└──────────────────────┘
```

---

## 前置条件

| 工具 | 用途 | 安装方式 |
|------|------|---------|
| **Node.js ≥ 18** | 运行环境 | https://nodejs.org |
| **npm** | 包管理 | 随 Node.js 安装 |
| **Firebase CLI** | 部署工具 | `npm install -g firebase-tools` |
| **Google 账号** | Firebase + Gemini | 已有即可 |
| **Gemini API Key** | AI 内容生成 | 从 AI Studio 获取 |

---

## Step 1: 获取 Gemini API Key

1. 打开 [Google AI Studio](https://aistudio.google.com/)
2. 登录 Google 账号
3. 点击左侧 **Get API Key** → **Create API Key**
4. 选择一个 Google Cloud 项目（或新建）
5. 复制生成的 API Key，**妥善保管**

> [!CAUTION]
> API Key 绝不能写入前端代码或提交到 Git。它只存放在 Firebase Functions 的环境变量中。

---

## Step 2: 创建 Firebase 项目

### 2.1 在 Firebase Console 创建项目

1. 打开 [Firebase Console](https://console.firebase.google.com/)
2. 点击 **添加项目**
3. 输入项目名（如 `iteippt`）
4. **关闭** Google Analytics（不需要）
5. 点击 **创建项目**，等待完成

### 2.2 开通所需服务

在 Firebase Console 左侧菜单中：

1. **Hosting** → 点击「开始」→ 一路下一步（不用执行命令，后面会做）
2. **Functions** → 需要升级为 **Blaze（即用即付）** 计划
3. **Storage** → 点击「开始」→ 选择 **以生产模式启动**

> [!WARNING]
> **Firebase Functions 必须使用 Blaze 计划**（免费额度很充足，每月 200 万次调用免费）。
> 进入 Firebase Console → 左下角齿轮 → **使用量和结算** → **升级到 Blaze**。
> 可设置预算提醒（如 ¥0），超出即停止服务，不会产生意外费用。

---

## Step 3: 本地初始化 Firebase

### 3.1 登录 Firebase CLI

```powershell
# 安装 Firebase CLI（如果还没有）
npm install -g firebase-tools

# 登录 Google 账号
firebase login
```

浏览器会弹出登录页面，授权后回到终端。

### 3.2 在项目根目录初始化

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT

# 初始化 Firebase（选择 Hosting + Functions + Storage）
firebase init
```

**交互式选择**（用空格选中，回车确认）：

```
? Which Firebase features do you want to set up?
  ◉ Hosting: Configure files for Firebase Hosting
  ◉ Functions: Configure a Cloud Functions directory
  ◉ Storage: Configure a default Storage bucket
```

**后续问答**：

| 问题 | 选择 |
|------|------|
| Use an existing project? | **Use an existing project** → 选你刚创建的 `iteippt` |
| **Functions** | |
| Language? | **TypeScript** |
| Use ESLint? | **No**（简化配置） |
| Install dependencies? | **Yes** |
| **Hosting** | |
| Public directory? | **`dist`**（Vite 构建输出目录） |
| Single-page app? | **Yes** |
| Set up automatic builds with GitHub? | **No** |
| **Storage** | |
| Storage Rules file? | **storage.rules**（默认即可） |

### 3.3 验证初始化结果

初始化后项目根目录应新增：

```
ITEIPPT/
├── firebase.json           ← Firebase 配置
├── .firebaserc             ← 项目绑定
├── storage.rules           ← Storage 安全规则
└── functions/              ← Cloud Functions 目录
    ├── src/
    │   └── index.ts
    ├── package.json
    └── tsconfig.json
```

---

## Step 4: 配置 Firebase 文件

### 4.1 编辑 `firebase.json`

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "/api/**",
        "function": "api"
      },
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  },
  "functions": {
    "source": "functions",
    "runtime": "nodejs20"
  },
  "storage": {
    "rules": "storage.rules"
  }
}
```

**关键配置说明**：
- `/api/**` 路由转发到 Cloud Functions（前端调用 `/api/plan` 等接口）
- 其他所有路由返回 `index.html`（SPA 路由）
- Functions 运行在 Node.js 20

### 4.2 编辑 `storage.rules`

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // PPTX 版本历史 — 允许读写（无 OAuth，内部使用）
    match /pptx-versions/{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

> [!NOTE]
> 规则设为完全开放是因为本系统**不上 OAuth**，仅内部使用。如果后续需要限制访问，可改为匿名认证或 IP 白名单。

---

## Step 5: 配置 Gemini API Key

### 5.1 设置 Functions 环境变量

```powershell
# 用 Firebase CLI 设置密钥（推荐方式）
firebase functions:secrets:set GEMINI_API_KEY
```

系统会提示输入值，粘贴你的 API Key 后回车。

### 5.2 在 Functions 代码中使用

`functions/src/index.ts` 中读取密钥：

```typescript
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const geminiApiKey = defineSecret("GEMINI_API_KEY");

export const api = onRequest(
  { secrets: [geminiApiKey], cors: true },
  async (req, res) => {
    const apiKey = geminiApiKey.value();
    // 使用 apiKey 调用 Gemini API...
  }
);
```

> [!TIP]
> **替代方案**：如果 `secrets` 命令不可用（需要 Blaze 计划），可以用 `.env` 文件：
> ```powershell
> # 在 functions/ 目录下创建 .env 文件
> echo GEMINI_API_KEY=your-api-key-here > functions/.env
> ```
> 然后在代码中用 `process.env.GEMINI_API_KEY` 读取。
> **确保 `.env` 在 `.gitignore` 中！**

---

## Step 6: 本地开发与测试

### 6.1 前端开发服务器

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT

# 安装前端依赖
npm install

# 启动 Vite 开发服务器
npm run dev
```

浏览器打开 `http://localhost:5173`。

### 6.2 本地模拟 Functions

```powershell
# 在另一个终端
cd c:\Users\61973\Documents\cc-projects\ITEIPPT\functions

# 安装 Functions 依赖
npm install

# 编译 TypeScript
npm run build

# 启动 Firebase 模拟器（Hosting + Functions + Storage）
cd ..
firebase emulators:start
```

模拟器 UI 地址：`http://localhost:4000`

| 服务 | 本地端口 |
|------|---------|
| Hosting | `http://localhost:5000` |
| Functions | `http://localhost:5001` |
| Storage | `http://localhost:9199` |

> [!TIP]
> **前端代理配置**：开发时前端跑在 `5173`，Functions 跑在 `5001`。在 `vite.config.ts` 中配置代理：
> ```typescript
> export default defineConfig({
>   server: {
>     proxy: {
>       '/api': {
>         target: 'http://localhost:5001/iteippt/us-central1',
>         changeOrigin: true,
>       }
>     }
>   }
> })
> ```

---

## Step 7: 构建与部署

### 7.1 构建前端

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT

# 构建 Vite 生产包
npm run build
```

构建产物输出到 `dist/` 目录。

### 7.2 编译 Functions

```powershell
cd functions
npm run build
cd ..
```

### 7.3 一键部署

```powershell
# 部署所有服务（Hosting + Functions + Storage Rules）
firebase deploy
```

或分别部署：

```powershell
# 只部署前端
firebase deploy --only hosting

# 只部署 Functions
firebase deploy --only functions

# 只部署 Storage 规则
firebase deploy --only storage
```

### 7.4 获取部署地址

部署成功后终端会显示：

```
✔ Deploy complete!

Hosting URL: https://iteippt.web.app
```

打开这个 URL 即可访问。

---

## Step 8: 部署后验证

### 8.1 检查清单

| 检查项 | 验证方法 |
|--------|---------|
| 前端页面加载 | 打开 `https://iteippt.web.app`，看到 6 步步骤条 |
| API 可达 | 浏览器访问 `https://iteippt.web.app/api/health`（如有） |
| Gemini API 连通 | 上传文档 → 框架规划 → 检查 AI 是否返回推荐 |
| Storage 可用 | 生成 PPT → 在 Firebase Console → Storage 查看是否有文件 |
| HTTPS 正常 | Firebase Hosting 自动提供 SSL 证书 |

### 8.2 查看 Functions 日志

```powershell
# 实时查看 Functions 日志（调试 API 问题）
firebase functions:log --only api
```

或在 [Firebase Console → Functions → 日志](https://console.firebase.google.com/) 中查看。

---

## 常见问题

### Q1: `firebase deploy` 报错 "No project active"

```powershell
# 检查当前绑定的项目
firebase projects:list

# 切换到正确的项目
firebase use iteippt
```

### Q2: Functions 部署失败 "Billing account not configured"

需要升级到 Blaze 计划。进入 Firebase Console → 项目设置 → 使用量和结算 → 修改方案 → Blaze。

### Q3: 前端部署后页面空白

检查 `firebase.json` 中 `public` 是否设为 `dist`（不是 `public` 或 `build`）。

```powershell
# 确认 dist 目录是否存在
ls dist/
```

### Q4: API 返回 CORS 错误

确保 Functions 代码中设置了 `cors: true`：

```typescript
export const api = onRequest({ cors: true }, async (req, res) => { ... });
```

### Q5: 如何更新部署？

```powershell
# 改完代码后
npm run build                    # 重新构建前端
cd functions && npm run build    # 重新编译 Functions
cd ..
firebase deploy                  # 重新部署
```

### Q6: 如何回滚到上一版本？

```powershell
# 查看 Hosting 版本历史
firebase hosting:channel:list

# Firebase Console → Hosting → 发布历史 → 选择旧版本 → 回滚
```

---

## 费用估算

Firebase Blaze 计划**按量付费**，免费额度如下：

| 服务 | 免费额度 | ITEIPPT 预估用量 |
|------|---------|-----------------|
| Hosting | 10 GB 存储 / 360 MB 传输 /天 | 远低于限制 |
| Functions | 200 万次调用 / 40 万 GB·秒 /月 | 每次生成 ~2 次调用 |
| Storage | 5 GB 存储 / 1 GB 下载 /天 | 每个 PPTX < 5MB |
| Gemini API | 见 [AI Studio 定价](https://ai.google.dev/pricing) | 每次生成 ~2 次 API 调用 |

> [!TIP]
> 正常内部使用（日均 < 50 次生成）**完全在免费额度内**，不产生费用。
> 建议在 Firebase Console 设置**预算提醒**（设为 ¥0 或 $1），超出即通知。

---

## 完整命令速查

```powershell
# ═══════════ 首次设置 ═══════════
npm install -g firebase-tools     # 安装 CLI
firebase login                    # 登录
firebase init                     # 初始化项目
firebase functions:secrets:set GEMINI_API_KEY  # 设置密钥

# ═══════════ 日常开发 ═══════════
npm run dev                       # 前端开发服务器
firebase emulators:start          # 本地模拟器

# ═══════════ 部署上线 ═══════════
npm run build                     # 构建前端
cd functions && npm run build && cd ..  # 编译 Functions
firebase deploy                   # 一键部署

# ═══════════ 运维调试 ═══════════
firebase functions:log            # 查看日志
firebase use <project-id>         # 切换项目
firebase hosting:channel:list     # 查看版本历史
```
