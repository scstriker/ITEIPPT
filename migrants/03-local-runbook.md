# 03 - Local Migration Runbook

> 目标：新环境 30 分钟内拉起“前端 + 本地代理后端”并完成关键验收。

## 0. 依赖
- Node.js 20+
- npm
- Windows PowerShell（以下命令基于 PowerShell）

## 1. 安装依赖
```powershell
cd <repo>\src
npm install

cd <repo>\functions
npm install
```

## 2. 配置前端环境变量
在 `src/.env` 写入（可从 `.env.example` 复制）：
```env
GEMINI_API_KEY="<your_api_key>"
API_PROXY_PORT="8787"
API_PROXY_TARGET="http://127.0.0.1:8787"
GEMINI_BASE_URL="https://generativelanguage.googleapis.com/v1beta"
GEMINI_PLAN_MODEL="gemini-2.5-flash"
GEMINI_CONTENT_MODEL="gemini-2.5-flash"
```

## 3. 启动本地双进程（推荐）
终端 A（本地代理后端）：
```powershell
cd <repo>\src
npm run proxy:dev
```

终端 B（前端）：
```powershell
cd <repo>\src
npm run dev
```

访问：`http://localhost:3000`

## 4. 可选：本地函数编译/模拟
仅在需要对齐云函数行为时执行。

编译：
```powershell
cd <repo>\functions
npm run build
```

模拟（需要 Firebase CLI）：
```powershell
cd <repo>\functions
npm run serve
```

## 5. 基础门禁
```powershell
cd <repo>\src
npm run lint
npm run build
npm run proxy:smoke

cd <repo>\functions
npm run build
```

## 6. 最新功能冒烟（建议）
1. Step1 上传文档后，封面标题应回填文档标题，机构应回填“所属机构”。
2. Step2 主表/子表均为 5 列，点击箭头后直接出现子章节表；删除为行尾 `X`。
3. Step2 子章节编号为 `1-1/1-2` 格式，新增删除后可重排。
4. Step3 顶部有“两种导入方式”说明，右侧有悬浮 `ITEI DRAW` 按钮。
5. 内容页二级标题在长文本下蓝底会扩宽或增高，正文不与标题重叠。
6. 正文高亮应为短语/整句，不应出现随机单字着色。

## 7. 常见故障
### A. Step2/Step3 报 Gemini 相关错误
排查：
1. `GEMINI_API_KEY` 是否有效。
2. `npm run proxy:dev` 是否在 8787 正常监听。
3. 执行 `npm run proxy:smoke` 查看代理健康。

### B. 端口占用（3000/8787）
```powershell
netstat -ano -p tcp | Select-String ":3000|:8787"
# 然后 Stop-Process -Id <pid> -Force
```

### C. functions 构建失败
```powershell
cd <repo>\functions
npm install
npm run build
```

### D. UI 文案乱码
这是仓库内历史编码污染，非运行环境问题；详见 `04-risks-and-next-actions.md`。
