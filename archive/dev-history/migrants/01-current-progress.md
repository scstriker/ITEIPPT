# 01 - Current Progress Snapshot

> 基准：`docs/implementation_plan.md`、`docs/PLAN.md`、当前仓库代码
> 截止：2026-04-11

## 一句话结论
当前仓库已稳定支持“本地前端 + 本地代理后端 + PPT 导出”闭环；近期重点改造（Step2 表格、Step3 导入、封面回填、二级标题自适应、正文语义高亮）均已落在主代码中并通过编译门禁。

## 当前主流程（代码实况）
1. 上传文档：`UploadPanel`（`PDF/DOCX`）
2. 框架规划：`FrameworkPlanner`（AI 建议 + 章节/子章节编辑）
3. 配图导入：`ImageImporter`（ITEI Draw + 本地图片）
4. 审计与导出：`ContentAuditor` + `GeneratePanel`

- 状态机：`src/hooks/useWorkflow.ts`
- 当前步序：`upload -> framework -> images -> audit`

## 最近已落地改动（按模块）
### Step1/封面链路
- 上传元信息（至少 `organization`）已传入 workflow。
- `setParsedDocument` 会同步写入：
  - `frameworkPlan.coverInfo.standardName`（首行标题，空则回退文件名）
  - `frameworkPlan.endingInfo.organization`
- 封面渲染改为“单标题模式”，不再强制 `《》` 与空计划号占位。

### Step2 章节编辑区
- 主表固定 5 列：`序号 / 章节名称 / 子章节数 / 内容 / 删除`。
- 子表固定 5 列：`序号 / 子章节名称 / 布局提示 / 内容 / 删除`。
- 展开后直接显示子章节表（移除中间蓝色说明块）。
- 子章节编号改为层级编号（`1-1/1-2/...`）。
- 删除操作统一为行尾 `X` 图标。
- 覆盖程度从独立列并入“内容”列前置 chip。

### Step3 配图导入
- 文案明确两种导入方式：
  - 复制提示词到 ITEI Draw 生成后上传。
  - 直接上传本地图片。
- 批量按钮文案更新为“批量导入图片”。
- 新增右侧中部悬浮 `ITEI DRAW` 动画跳转按钮。

### 内容页渲染与高亮
- 二级标题蓝底自适应：按标题长度扩宽，超长则换行并增高蓝底。
- 保持模板字号，不截断标题文本；正文区自动下移避免重叠。
- 正文高亮改为“映射短语优先 + 整句兜底”，最大 2 处且受覆盖率上限约束。

## 最近编译/门禁状态（本次复核）
- `src`: `npm run lint` 通过（TypeScript noEmit）
- `src`: `npm run build` 通过（Vite 构建成功）
- `functions`: `npm run build` 通过（`tsc -p tsconfig.json`）

## 关键注意点
- 历史 `functions/src/index.ts:78` 字符串/编码损坏导致 TS 语法错误问题，当前已不再阻塞构建。
- 但仓库仍有部分中文字面量编码污染（见风险文档），需要单独做文本清理。
- 当前 Git 工作区非常脏，迁移接手前建议先做“快照提交 + 新分支”。

## 新窗口接手顺序
1. 先跑 [`03-local-runbook.md`](./03-local-runbook.md) 完成本地启动。
2. 再读 [`02-repo-analysis.md`](./02-repo-analysis.md) 对齐模块边界。
3. 按 [`05-handoff-checklist.md`](./05-handoff-checklist.md) 逐项验收。
