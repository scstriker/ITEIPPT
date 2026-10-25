# ITEISlides

把一份 `.pdf` 或 `.docx` 文档整理成 ITEI 模板的汇报 PPT。4 步：上传文档 → 规划框架（Gemini 规划章节、生成逐页内容）→ 配图导入 → 审计预览并导出 `.pptx`。使用说明见 `docs/ITEISlides_使用手册_V1.0.pdf`，手册的源文件和生成脚本在 `manual/`。

| 目录 | 内容 |
|---|---|
| `src/` | 前端：React 19、TypeScript 7、Vite 8、Tailwind CSS 4、shadcn/ui，界面遵循 `design/itei/` |
| `worker/` | 后端：Cloudflare Worker（同时提供前端页面；本地可用 Node 运行） |
| `docs/` | 需求、技术规格、验收、接口、安全、决策记录、部署文档、模板参考 |
| `design/itei/` | ITEI 设计规范 |
| `archive/` | 过程文件，不作为事实源 |

## 本地运行

需要 Node.js 22 和 npm。首次安装依赖：

```bash
cd worker && npm install
```

```bash
cd src && npm install
```

在 `src/.env` 写入 `GEMINI_API_KEY`（可复制 `src/.env.example`）。然后开两个终端，都在 `src/` 下：

```bash
npm run proxy:dev
```

```bash
npm run dev
```

打开 `http://localhost:3000`。Windows 下也可以运行 `scripts/start-local.ps1` 一次启动两者。

## 测试

| 命令（在对应目录执行） | 覆盖 |
|---|---|
| `worker`: `npm test` | 后端接口合同、Access 校验、规划、生成结果快照（Gemini 用本地桩） |
| `worker`: `npm run smoke:workerd` | 在本机 Cloudflare 运行时中检查 Access 校验和接口 |
| `src`: `npm test` | 流程状态机、各步骤规则、PPTX 渲染快照、乱码扫描 |
| `src`: `npm run e2e` | 手册中的全部操作（生产构建 + 浏览器内假后端） |
| `src`: `npm run e2e:local` | 真实本地后端 + Gemini 桩跑通 4 步 |
| `src`: `npm run e2e:real` | 真实 Gemini（消耗额度，需有效 Key，按需运行） |
| `src`: `npm run gate:phase1` | 导出文件与模板原件的结构比对 |

验收条件与测试的对应关系见 `docs/ACCEPTANCE.md`。

## 部署

部署在 Cloudflare（Worker + Access），不使用 Firebase。步骤见 `docs/cloudflare-deployment.md`，安全要求见 `docs/SECURITY.md`。Gemini Key 只通过 `npx wrangler secret put GEMINI_API_KEY` 写入 Cloudflare，不要提交到仓库。
