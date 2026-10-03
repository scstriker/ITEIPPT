# ITEISlides 开发说明

把长文档（PDF / DOCX）整理成 ITEI 模板 PPT 的 Web 应用。前端 `src/`，后端 `functions/`（Firebase Functions，本地用 `functions/src/dev/localServer.ts`）。

## 先读

1. `docs/PRD.md`：需求与已知差异（第 11 节）
2. `docs/TECH_SPEC.md`：架构、数据流、状态归属、限制
3. `docs/ACCEPTANCE.md`：验收条件和对应测试
4. `docs/API.md`、`docs/SECURITY.md`、`docs/decisions/`

UI 规范见 `design/itei/AGENTS.md`。`archive/` 是过程文件，不作为事实源。

## 常用命令

```bash
cd functions && npm test          # 后端合同与单元测试
cd src && npm test                # 前端单元与渲染快照
cd src && npm run e2e             # Playwright 端到端
cd src && npm run e2e:local       # 真实本地后端 + Gemini 桩跑通 4 步
cd src && npm run proxy:dev       # 本地后端 :8787（读 src/.env）
cd src && npm run dev             # 前端 :3000
cd src && npm run gate:phase1     # PPTX 结构门禁
```

## 约定

- 改行为先改 `docs/PRD.md` 和 `docs/ACCEPTANCE.md`，再写失败测试，再实现。
- 界面文字以 `src/` 源码为准，E2E 用文字和角色定位，改文案要同步测试。
- 不要把 Key 写进代码或文档；本地 Key 只放 `src/.env`。
