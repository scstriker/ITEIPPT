# ITEIPPT v2.0 下一步执行计划（2026-04-09）

## Summary
- 已完成主干闭环（本地）：
  - Step 1 文档上传解析（PDF/DOCX/DOC）
  - Step 2 框架规划（`/api/plan` + AI 章节理由/充足度）
  - Step 3 内容生成（`/api/generate-content` + 进度看板）
  - Step 6 PPT 生成面板与下载
- 已完成基础工作流编排：
  - `useWorkflow` + `App.tsx` 六步路由（upload/framework/content/images/audit/generate）
  - Step 4/5 已有可用组件（图片导入、内容审核）
- 已完成 v1 视觉体系迁移：
  - Header + 6步 stepper 对齐 v1 风格
  - Step 1 复刻两栏上传界面（基本设置/日志 + 上传摘要）
  - Step 2 复刻单卡表格规划界面
  - Step 5 保留双栏结构并套用 v1 审计卡视觉
- 已完成 `P5-02`：
  - 图片页未导入图片时，PPT 自动渲染 ITEI Draw 提示词占位文本。
- 仍保持约束：
  - `P1-08` 自动视觉对比保持 `blocked`（缺 `soffice/pdftoppm`）。

## 当前状态快照
| 领域 | 状态 | 说明 |
|---|---|---|
| 模板渲染与 Gate | completed / partial_blocked | 结构门禁通过；自动视觉对比冻结 |
| 本地 API 代理 | completed | `/api/plan`、`/api/generate-content`、`/api/*` 已可联调 |
| 六步前端流程 | completed (MVP) | 6 步路由与数据流已打通 |
| Firebase Functions 迁移 | partial | `/api/plan` 已迁移代码落地，待部署验证 |

## 下一步优先级（执行顺序）
1. `P4-02` Step 4 能力增强
   - 图片导入页增加批量上传、缩略图预览、替换/清空、导入计数
   - 与 `GeneratePanel` 的 `imageFiles` 映射做一致性校验

2. `P5-03` Step 5 审核增强（新增任务）
   - 审核页支持表格 inline 编辑、溯源徽章可视化（`exact/paraphrased/ai_*`）
   - 输出审计报告（markdown）草稿

3. `P3-03B` `generate-content` 扩展 SSE（新增任务）
   - 在保留 HTTP 稳定版本前提下，新增 SSE 进度事件
   - 前端进度看板由模拟进度切换到服务端真实进度

4. `P8-01/P8-02` 存储与版本历史
   - 生成后的 PPT 自动存档（Firebase Storage）
   - 历史版本列表与下载

5. `P3-02B` 部署验证收口
   - 在 Firebase 上部署 `/api/plan` 并验证 CORS、Gemini 稳定性
   - 若通过，再迁移 `/api/generate-content`

## 门禁策略
- 每次编码后：`npm run lint`
- 涉及接口联调：`npm run build` + `npm run proxy:smoke`
- 涉及 PPT 渲染：`npm run gate:phase1`
- 视觉门禁：环境具备后再恢复 `P1-08`

## 里程碑
- Milestone A（已达成）：Step 1-3-6 本地可运行闭环
- Milestone B（下一目标）：Step 4/5 可用于真实内容审阅与图片替换
- Milestone C（下一目标）：SSE 真实进度 + Firebase 版本存档

## 2026-04-09 Update
- `P3-02C` completed: after running AI chapter analysis, `/api/plan` now auto-decides each sub-slide `visualMode` (`table` or `images`) and returns `apiPlanMeta.slideInsights`.
- `FrameworkPlanner` now renders AI auto decisions as read-only mode chips and reasons; manual `visualMode` dropdown editing has been removed.
- Local proxy and Firebase Functions implementations are kept aligned for the `/api/plan` schema.

## 2026-04-10 Update
- P3-02D completed: Step2 `contentHint` is now read-only and AI-generated only.
- `/api/plan` now applies strict incremental recompute: only dirty chapters/slides are updated, untouched sections remain unchanged.
- Dirty merge now updates both `visualMode` and `contentHint`, so Step3 consumes latest framework hints after AI adjustment.
- P5-03B completed: Step5 is now a canvas-first audit workbench with compact grouped page index (content/all/problem filters), 16:9 semantic preview canvas, and task-oriented tabs (`trace/body/supplements/missing`) with compact empty states.
- P3-02E completed: Step2 AI planning no longer hard-fails on transient Gemini output/upstream issues; `/api/plan` now falls back to deterministic local heuristics for dirty targets (while keeping missing/invalid key errors explicit), and frontend now shows actionable failure reasons (auth/quota/network/upstream).
