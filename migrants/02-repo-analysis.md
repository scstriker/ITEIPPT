# 02 - Repository Analysis

> 目标：10 分钟内掌握“哪里改、改了什么、怎么验证”。

## 目录结构（高价值）
- `src/`
  - `components/`：步骤页面与核心交互（上传/规划/配图/审计/导出）
  - `hooks/useWorkflow.ts`：4 步状态机与跨步骤数据承接
  - `services/`：本地代理服务、PPT 渲染、API 客户端、文档解析
  - `config/`：模板加载、预设、背景资源
  - `types/`：`framework/template/analyzer` 类型
- `functions/`
  - `src/index.ts`：云端 Functions API（与本地代理协议对齐）
- `docs/`
  - 计划、模板、部署与阶段记录

## 核心数据链路
1. `UploadPanel` 解析文档并写入 `ParsedDocument`。
2. `useWorkflow.setParsedDocument` 回填封面标题与机构到 `frameworkPlan`。
3. `FrameworkPlanner` 调 `requestFrameworkPlan(/api/plan)` 输出章节洞察。
4. `FrameworkPlanner` 调 `requestGenerateContent(/api/generate-content)` 生成 `AnalyzerResult`。
5. `ImageImporter` 将上传图片映射到 `page-slot`。
6. `ContentAuditor` 编辑结果；`GeneratePanel` 调 `renderPPTX` 导出。

## 当前关键模块与职责
### `src/components/FrameworkPlanner.tsx`
- 5 列主表 + 5 列子表。
- 行内抽屉管理子章节，序号层级化。
- `AI 建议调整` 悬浮按钮固定右侧中部。

### `src/components/ImageImporter.tsx`
- 页面抽屉 + 槽位导入。
- 支持“提示词复制生成”与“本地图片上传”两种流程。
- `ITEI DRAW` 悬浮链接固定右侧中部。

### `src/hooks/useWorkflow.ts`
- 管理 `parsedDocument/frameworkPlan/analyzerResult/importedImages`。
- Step1 元信息进入计划数据：标题用于封面，机构用于封面+结束页。

### `src/services/apiProxyServer.ts`
- 提供 `/api/plan` 与 `/api/generate-content`。
- 生成阶段统一重算 `highlightRanges`：映射短语优先，整句兜底。
- `normalizeOptionalText` 处理空串，避免空值覆盖有效兜底。

### `src/services/pptxRenderer.ts`
- 封面：单标题渲染，不显示空占位文本。
- 内容页：二级标题蓝底自适应（宽度/高度），正文区避让。
- 正文：按 `highlightRanges` 进行主色+强调色分段渲染。

### `functions/src/index.ts`
- 云端计划接口与本地代理保持同类逻辑。
- 当前可构建，但仍有部分中文字符串编码污染，建议后续统一清理。

## 已知架构偏差
- 计划文档历史上有 6 步描述；当前可运行主流程是 4 步。
- `ContentGenerator` 组件仍在仓库中，但不再作为独立步骤展示。

## 近期高频改动文件（接手优先读）
- `src/components/FrameworkPlanner.tsx`
- `src/components/ImageImporter.tsx`
- `src/hooks/useWorkflow.ts`
- `src/services/apiProxyServer.ts`
- `src/services/pptxRenderer.ts`
- `src/styles.css`
- `functions/src/index.ts`

## 主要技术债
1. 中文字面量编码污染仍存在（`UploadPanel`、`functions` 部分默认文本等）。
2. 工作区变更边界混杂，提交粒度不清晰。
3. 本地代理与 Functions 双实现长期存在漂移风险。
4. 缺少针对“排版自适应 + 高亮语义”的自动化回归。
