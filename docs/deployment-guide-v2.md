# ITEIPPT v2.0 部署与打包指南（v2）

本文档基于当前仓库结构与脚本现状编写，替代旧版部署说明中的过时路径与命令。

## 1. 当前仓库事实（2026-04）

- 前端工程位于 `src/`（Vite + React + TypeScript）。
- 本地 API 代理位于 `src/services/apiProxyServer.ts`，由 `npm run proxy:dev` 启动。
- 本地代理当前提供：
  - `POST /api/plan`
  - `POST /api/generate-content`
  - `ALL /api/*` 转发 Gemini 官方 API
- Firebase Functions 位于 `functions/`，当前仅实现 `POST /api/plan`。

> 结论：若要保证 Step1~Step6 全链路可用，当前推荐使用“前端 + 本地代理”双进程打包/部署策略。

---

## 2. 打包策略（v2）

### 策略 A（推荐，当前可落地）

适用：本地验收、内网部署、演示环境、功能完整性优先。

- 前端打包产物：`src/dist/`
- API 运行层：Node 进程运行 `npm run proxy:dev`
- 前端通过 `API_PROXY_TARGET` 指向代理地址（默认 `http://127.0.0.1:8787`）

优点：与当前代码能力完全一致，Step2/Step3 都可用。

### 策略 B（半云部署）

适用：先上云验证 Step2。

- Firebase Hosting 托管前端静态资源
- Firebase Functions 承载 `/api/plan`
- `/api/generate-content` 仍需本地代理或后续迁移

风险：若未迁移 `/api/generate-content`，Step3 在纯云环境不可用。

### 策略 C（完整云部署，后续目标）

前提：将 `/api/generate-content` 迁移到 Functions，并与本地代理保持同协议。

---

## 3. 本地打包与运行（策略 A）

### 3.1 安装依赖

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT\src
npm ci
```

如需云函数构建验证：

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT\functions
npm ci
```

### 3.2 环境变量

在 `src/` 下创建 `.env`（可从 `.env.example` 复制）：

```env
GEMINI_API_KEY=你的密钥
API_PROXY_PORT=8787
API_PROXY_TARGET=http://127.0.0.1:8787
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_PLAN_MODEL=gemini-2.5-flash
GEMINI_CONTENT_MODEL=gemini-2.5-flash
```

### 3.3 质量门禁（打包前）

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT\src
npm run lint
npm run build
npm run proxy:smoke
npm run gate:phase1
```

### 3.4 启动服务（双进程）

终端 A：

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT\src
npm run proxy:dev
```

终端 B：

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT\src
npm run dev
```

访问：`http://127.0.0.1:3000`

---

## 4. 打包产物定义（策略 A）

前端产物（可静态托管）：

- `src/dist/index.html`
- `src/dist/assets/*`

运行依赖（必须随部署环境提供）：

- `src/.env`（至少含 `GEMINI_API_KEY`）
- Node 20+
- `src/node_modules`（或在目标机重新 `npm ci`）
- 本地代理进程（`npm run proxy:dev`）

---

## 5. Firebase 部署说明（策略 B）

### 5.1 适用边界

- 当前 Functions 仅有 `/api/plan`。
- 若直接切到纯 Firebase API，Step3 会缺 `/api/generate-content`。

### 5.2 Hosting 构建目录

如果在仓库根目录执行 Firebase 部署，`hosting.public` 应指向：

- `src/dist`

示例 `firebase.json`（按当前结构）：

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
  "functions": {
    "source": "functions",
    "runtime": "nodejs20"
  }
}
```

### 5.3 Functions 环境变量

`functions` 需要：

- `GEMINI_API_KEY`
- `GEMINI_BASE_URL`（可选）
- `GEMINI_PLAN_MODEL`（可选）
- `ALLOWED_ORIGINS`（可选）

---

## 6. 发布检查清单（v2）

发布前至少满足：

1. `src`：`npm run lint` 通过
2. `src`：`npm run build` 通过
3. `src`：`npm run proxy:smoke` 通过
4. `src`：`npm run gate:phase1` 通过
5. 若涉及 Functions：`functions` 下 `npm run build` 通过

---

## 7. 常见问题（按当前仓库）

### Q1：页面能打开，但 AI 接口报错 `missing_api_key`

- 检查 `src/.env` 是否有 `GEMINI_API_KEY`
- 重启 `npm run proxy:dev`

### Q2：Step2 可用，Step3 失败

- 说明你在走 Firebase `/api/plan`，但 `/api/generate-content` 尚未迁移到云端
- 请切回本地代理策略，或先完成 Functions 迁移

### Q3：部署后空白页

- 检查 Hosting 的 `public` 是否为 `src/dist`（不是根目录 `dist`）

---

## 8. v2 变更摘要（相对旧版文档）

- 修正前端工程路径为 `src/`。
- 修正本地启动命令为 `src/package.json` 中的脚本。
- 将“完整可用部署”定义为“前端 + 本地代理”双进程。
- 明确标注 Firebase 当前仅覆盖 `/api/plan`，避免误配导致 Step3 不可用。
