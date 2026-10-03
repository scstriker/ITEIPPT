# 验收规格：ITEISlides

测试命令：

- 后端：`cd functions && npm test`
- 前端单元与渲染：`cd src && npm test`
- 端到端：`cd src && npm run e2e`（Playwright；前端用 `page.route` 返回 API 夹具，`local-backend.spec.ts` 例外，连真实本地后端 + Gemini 桩）

E2E 只用界面文字和 ARIA 角色定位元素，界面重写后测试不改。夹具文件均为合成数据，文件名带“（示例）”。

## 追溯表

| 需求 | 验收 | 方式 |
|---|---|---|
| FR-001 | AC-001、AC-002 | 自动（E2E） |
| FR-002 | AC-003 | 自动（E2E） |
| FR-003 | AC-004 | 自动（E2E） |
| FR-004 | AC-005、AC-006 | 自动（E2E） |
| FR-005 | AC-007 | 自动（E2E） |
| FR-006 | AC-008 | 自动（E2E） |
| FR-007 | AC-009、AC-010 | 自动（E2E） |
| FR-008 | AC-011、AC-012 | 自动（E2E、后端合同） |
| FR-009 | AC-013、AC-014、AC-015、AC-016 | 自动（E2E） |
| FR-010 | AC-017 | 自动（后端快照） |
| FR-011 | AC-018、AC-019、AC-020 | 自动（E2E） |
| FR-012 | AC-021、AC-022 | 自动（E2E） |
| FR-013 | AC-023、AC-024、AC-025 | 自动（E2E、渲染快照） |
| FR-014 | AC-026、AC-027 | 自动（后端合同） |
| FR-015 | AC-028 | 自动（内存实现）+ 人工（线上） |
| NFR-001 | AC-030 | 检查 |
| NFR-002 | AC-029 | 自动（E2E） |
| NFR-003 | AC-024、AC-031 | 自动 |
| NFR-004 | AC-032 | 人工检查 |
| NFR-005 | AC-033 | 自动 |
| NFR-006 | AC-034 | 检查 |

## AC-001 — 上传有效文档

**Requirement:** FR-001

**Given** 位于“上传文档”。**When** 选择一个可提取文本的 `.docx`，或一个 `.pdf`。**Then** 日志出现“文档已解析并可进入下一步。”，文件名和大小（KB）显示在上传区下方，“下一步 →”可用。

**Verification:** automated · `src/e2e/upload.spec.ts`

**Status:** NOT RUN

## AC-002 — 拒绝不支持的文件

**Requirement:** FR-001

**Given** 位于“上传文档”。**When** 分别选择 `.doc`、`.txt`、超过 20 MB 的 `.pdf`、无文字的 `.pdf`。**Then** 依次显示“文件格式不支持，仅允许 .pdf / .docx。”（`.doc` 与 `.txt` 都在扩展名校验时拦截）、同上、“文件过大，请上传不超过 20MB 的文档。”、“未提取到有效文本，请确认文件不是扫描图片或加密文档。”；“下一步 →”保持不可用。

**Verification:** automated · `src/e2e/upload.spec.ts`

**Status:** NOT RUN

## AC-003 — 封面与结束页回填

**Requirement:** FR-002

**Given** 汇报人填“张三（示例）”，所属机构保持默认。**When** 上传首行为“某某标准（示例）”的文档并走完生成。**Then** `/api/generate-content/jobs` 请求体的 `frameworkPlan.coverInfo.standardName` 为“某某标准（示例）”、`presenter` 为“张三（示例）”、`endingInfo.organization` 为“机械工业仪器仪表综合技术经济研究所”。首行为空时 `standardName` 为去掉扩展名的文件名。

**Verification:** automated · `src/e2e/upload.spec.ts`、`src/tests/workflow.test.ts`

**Status:** NOT RUN

## AC-004 — 文档摘要与日志

**Requirement:** FR-003

**Given** 上传成功。**Then** “文档摘要”的标题为首个非空行，领域为 `DOCX` 或 `PDF`，摘要为正文前 160 字；日志依次有“已选择文件：…”“开始提取并分析文档内容…”“文档已解析并可进入下一步。”。

**Verification:** automated · `src/e2e/upload.spec.ts`、`src/tests/upload.test.ts`

**Status:** NOT RUN

## AC-005 — 进入条件与阻塞提示

**Requirement:** FR-004

**Given / When / Then：**

- 未上传时，显示“请先上传并解析文档，再进入下一步。”，步骤 2～4 不可点。
- 在“规划框架”未生成时，显示“请先在当前框架下生成内容，再进入下一步。”。
- 生成后修改任一章节名称，显示“框架已修改，之前生成的内容已失效。请重新生成后再进入下一步。”，步骤 3、4 不可点。

**Verification:** automated · `src/e2e/navigation.spec.ts`、`src/tests/workflow.test.ts`

**Status:** NOT RUN

## AC-006 — 导航确认弹窗

**Requirement:** FR-004

**When** 点“下一步 →”。**Then** 弹出“确认进入下一步？”，内容为“即将从“上传文档”进入“规划框架”。”；点“取消”留在原步骤，点“进入下一步”跳转。“← 上一步”弹出“确认返回上一步？”；点步骤条弹出“确认切换步骤？”。

**Verification:** automated · `src/e2e/navigation.spec.ts`

**Status:** NOT RUN

## AC-007 — 开始新任务

**Requirement:** FR-005

**Given** 已生成内容并导入 1 张图片，位于“审计预览”。**When** 点“开始新任务”并点“确认清空并开始”。**Then** 回到“上传文档”，文档摘要恢复为“待上传文档”，步骤 2～4 不可点。

**Verification:** automated · `src/e2e/navigation.spec.ts`

**Status:** NOT RUN

## AC-008 — 预设模板切换与重置

**Requirement:** FR-006

**Given** 进入“规划框架”。**Then** “预设模板”默认为“自定义”，表格无章节行。**When** 选“学术研究汇报”。**Then** 出现 4 个章节，首章为“一、研究背景与意义”，预计页数为 14。**When** 删除一个章节后点“重置默认”并确认。**Then** 恢复 4 个章节。

**Verification:** automated · `src/e2e/framework.spec.ts`

**Status:** NOT RUN

## AC-009 — 章节增删

**Requirement:** FR-007

**When** 点“+ 添加章节”并确认。**Then** 新增“第N章”，自动展开，带 1 个“新子章节”。**When** 删除章节并确认“确认删除”。**Then** 序号重排。只剩 1 章时，删除按钮不可用。

**Verification:** automated · `src/e2e/framework.spec.ts`、`src/tests/framework.test.ts`

**Status:** NOT RUN

## AC-010 — 子章节编辑

**Requirement:** FR-007

**When** 展开第 1 章。**Then** 子章节序号为 `1-1`、`1-2`……。**When** 子章节数改为 3。**Then** 末尾补“子章节 3”，布局与上一个相同。**When** 改为 1。**Then** 只剩第一个子章节，其删除按钮不可用。子章节数输入超过 20 时按 20 处理。

**Verification:** automated · `src/e2e/framework.spec.ts`、`src/tests/framework.test.ts`

**Status:** NOT RUN

## AC-011 — AI 建议调整的前端合并

**Requirement:** FR-008

**Given** “自定义”模板，无章节。**When** 点“AI 建议调整”并确认“开始分析”，夹具返回 6 章。**Then** 表格出现 6 章，“AI 调整建议”列出每章理由，覆盖度汇总显示“章节覆盖评估：高覆盖 a / 中覆盖 b / 低覆盖 c”。已有章节时，只更新理由、覆盖度和布局，章节名称不变。接口返回 `missing_api_key` 时显示“服务端未配置 GEMINI_API_KEY，无法生成 AI 推荐结果。”。

**Verification:** automated · `src/e2e/framework.spec.ts`、`src/tests/framework.test.ts`

**Status:** NOT RUN

## AC-012 — /api/plan 后端行为

**Requirement:** FR-008、FR-014

**Given** Gemini 桩。**Then**

- 正常返回时，`slides[].visualMode` 与桩给的布局一致，`provider` 为 `gemini:<model>`。
- `blank` 且无章节时，不调用草拟，结果为固定的 6 章（“一、背景与目标”……“六、结论与建议”）、每章 2 个子章节；只有 1 章时补齐到 6 章，原章节保留。
- 桩返回 500 或非 JSON 时，返回 200，`provider` 以 `:fallback` 结尾。
- 未配置 Key 时返回 503 `missing_api_key`。

**Verification:** automated · `functions/tests/plan.contract.test.ts`

**Status:** NOT RUN

## AC-013 — 生成任务成功

**Requirement:** FR-009

**Given** 框架合法。**When** 点“开始生成内容”并确认“开始生成”，夹具按 queued → running（40%）→ succeeded 返回。**Then** 确认弹窗保持打开且按钮不可用，页面按钮显示“任务执行中...”，进度条显示百分比和阶段文字；任务结束后弹窗关闭；成功后显示“已生成页数”和“原文覆盖率”，“下一步 →”可用。章节名称为空时点击显示“第 1 章标题不能为空。”且不发请求。

**Verification:** automated · `src/e2e/generate.spec.ts`

**Status:** NOT RUN

## AC-014 — 生成失败与重试

**Requirement:** FR-009

**When** 任务状态返回 `failed`。**Then** 显示错误信息，按钮变为“重新生成内容”并出现“重新生成”；再次点击创建新任务。结果带 `generationMeta.mode = degraded` 且原因含 `batch_generation_failed` 时，显示“已降级生成，可继续编辑（原因：batch_generation_failed）。”。

**Verification:** automated · `src/e2e/generate.spec.ts`

**Status:** NOT RUN

## AC-015 — 任务记录的恢复与清除

**Requirement:** FR-009

**Given** `sessionStorage` 中有进行中的任务记录。**When** “规划框架”挂载时框架摘要与记录相同。**Then** 显示“正在恢复任务状态”并继续轮询同一 `jobId`。**When** 摘要不同（例如刷新后重新上传，框架回到默认）。**Then** 记录被清除，不发轮询请求。

**Verification:** automated · `src/e2e/generate.spec.ts`（摘要相同的情形通过预写 `sessionStorage` 并构造同一框架模拟）

**Status:** NOT RUN

## AC-016 — 框架改动使结果失效

**Requirement:** FR-009

**Given** 生成成功。**When** 修改子章节名称。**Then** 显示“框架已改动，之前生成的内容已失效。请重新点击“开始生成内容”。”，步骤 3、4 不可点；把名称改回原值后恢复可用。

**Verification:** automated · `src/e2e/generate.spec.ts`、`src/tests/workflow.test.ts`

**Status:** NOT RUN

## AC-017 — 生成结果结构

**Requirement:** FR-010

**Given** Gemini 桩按脚本返回，系统时间固定。**When** 对 2 章 × 2 子章节（含 table 与 images 布局）生成。**Then** 结果快照不变：页序为封面、目录、2 正文、目录、2 正文、结束页（共 8 页）；正文不超过 220 字；高亮最多 2 处；表格页有 `tableData`，图片页有 `imagePrompts`；桩对某批返回 500 时该批页面计入缺失项，`generationMeta.mode = degraded`。

**Verification:** automated · `functions/tests/generate-content.golden.test.ts`

**Status:** NOT RUN

## AC-018 — 单槽位导入

**Requirement:** FR-011

**When** 在第一个槽位点“上传图片”选择 PNG 并“确认上传”。**Then** 预览显示图片，按钮变为“替换图片”，计数为“已导入 1/N”。**When** 点“移除”并确认。**Then** 预览变回“未上传图片”。选择非图片文件时显示“文件“…”不是图片格式，请重新选择。”。

**Verification:** automated · `src/e2e/images.spec.ts`

**Status:** NOT RUN

## AC-019 — 批量导入

**Requirement:** FR-011

**Given** 空槽位 3 个。**When** “批量导入图片”选 4 张并确认。**Then** 3 个槽位按页面顺序填满，提示“已导入 3 张图片，超出的 1 张未使用。”。

**Verification:** automated · `src/e2e/images.spec.ts`、`src/tests/images.test.ts`

**Status:** NOT RUN

## AC-020 — 复制描述、外链与无图片页

**Requirement:** FR-011

**Then** 点“复制图片描述”后剪贴板内容为该槽位提示词，提示“已复制第 n 页图片 m 的描述。”；“ITEI DRAW”链接指向 `https://draw.sensor-cloud.org/` 且 `target=_blank`。结果中没有图片页时显示“当前内容中没有需要图片的页面，可直接进入审计预览。”。

**Verification:** automated · `src/e2e/images.spec.ts`

**Status:** NOT RUN

## AC-021 — 审计预览浏览

**Requirement:** FR-012

**Then** 指标卡显示总页数、原文覆盖率、AI 补充项、缺失项，与夹具 `auditSummary` 一致；默认筛选“仅正文”只列正文页；“全部页面”含封面和结束页；“仅问题页”只列有补充项、缺失项或低覆盖的页；4 个页签可切换。

**Verification:** automated · `src/e2e/audit.spec.ts`

**Status:** NOT RUN

## AC-022 — 审阅编辑

**Requirement:** FR-012

**When** 在“正文编辑”把正文改为 160 字。**Then** 显示“字数：160/150”；导出预检把该页列入超字数页面。修改表格单元格后，导出的 PPTX 中对应单元格为新值。

**Verification:** automated · `src/e2e/audit.spec.ts`、`src/e2e/export.spec.ts`

**Status:** NOT RUN

## AC-023 — 导出预检与确认

**Requirement:** FR-013

**Given** 有 1 个槽位未导入、1 页超 150 字。**Then** 显示“仍有 1 个图片槽位未导入，导出后将使用占位文本。”和超字数警告。**When** 点“生成 PPTX”。**Then** 确认弹窗内容含“风险提示：缺少 1 个图片槽位；页面 n 正文超 150 字”。

**Verification:** automated · `src/e2e/export.spec.ts`

**Status:** NOT RUN

## AC-024 — 渲染结果符合模板

**Requirement:** FR-013、NFR-003

**Given** 固定的幻灯片夹具（封面、目录、无图 / 表格 / 两图 / 占位提示词 / 长子标题 / 高亮正文、结束页）。**When** 调用 `renderPPTX`。**Then** 每页 slide XML（去掉随机 ID 后）与快照一致。

**Verification:** automated · `src/tests/pptx-render.snapshot.test.ts`

**Status:** NOT RUN

## AC-025 — 下载

**Requirement:** FR-013

**When** 生成成功后点“下载生成文件”并确认。**Then** 下载文件名为 `ITEIPPT_v2_output.pptx`，页数等于结果 `slidePlan` 长度。

**Verification:** automated · `src/e2e/export.spec.ts`

**Status:** NOT RUN

## AC-026 — 接口契约

**Requirement:** FR-014

**Then** `docs/API.md` 列出的每个接口、每个错误码都有测试：健康检查；规划的 400 / 503；任务创建 202、状态、结果、404、409；同步接口的 400 / 503 和整体失败时的降级结果。

**Verification:** automated · `functions/tests/api.contract.test.ts`、`functions/tests/jobs.contract.test.ts`

**Status:** NOT RUN

## AC-027 — 关闭 Gemini 透传

**Requirement:** FR-014

**When** 请求 `POST /api/models`、`GET /api/models/gemini-2.5-flash`、`POST /api`。**Then** 都返回 404 `not_found`，Gemini 桩没有收到任何请求。

**Verification:** automated · `functions/tests/api.contract.test.ts`

**Status:** NOT RUN

## AC-028 — 任务存储与执行

**Requirement:** FR-015

**Then**（内存实现）任务按 queued → running → succeeded / failed 变化；进度百分比限制在 0～100；worker 跳过已结束任务和 10 分钟内仍在运行的任务；过期任务被清理。Pub/Sub 消息的 `json` 和 base64 `data` 两种格式都能解析出 `jobId`。线上 Firestore 实现在部署后由用户人工验证一次完整任务。

**Verification:** automated · `functions/tests/jobs.store.test.ts`、`functions/tests/worker.test.ts`；manual · `docs/cloud-deployment.md` 自检步骤

**Status:** NOT RUN

## AC-029 — 本地完整运行

**Requirement:** NFR-002

**Given** 本地后端指向 Gemini 桩，不启动任何 Firebase 服务。**When** 在浏览器走完上传、AI 建议调整、生成、导出。**Then** 全部成功，下载到 PPTX。

**Verification:** automated · `src/e2e/local-backend.spec.ts`；manual · Goal 7 用真实 Key 跑一次

**Status:** NOT RUN

## AC-030 — Key 不进前端

**Requirement:** NFR-001

**Then** `src/dist/` 和 `src/` 源码中搜不到 `GEMINI_API_KEY` 的值和 `AIza` 开头的字符串。

**Verification:** inspection · `npm run build` 后 `grep -r "AIza" src/dist`

**Status:** NOT RUN

## AC-031 — 结构门禁

**Requirement:** NFR-003

**Then** `cd src && npm run gate:phase1` 输出“Structure assertions passed.”。

**Verification:** automated

**Status:** NOT RUN

## AC-032 — ITEI 界面检查

**Requirement:** NFR-004

**Then** 4 个步骤在浅色、深色主题下的截图逐项满足：页眉 56 px 渐变且深蓝底上无彩色标志；直角（控件最多 2 px）；每屏大面积红色不超过 1 处；无 emoji；焦点环 2 px；错误提示带“错误”字样；字体为微软雅黑栈，无外链字体。

**Verification:** manual · Playwright 截图 `src/e2e/screenshots.spec.ts` 生成，人工逐项核对

**Status:** NOT RUN

## AC-033 — 界面文字无乱码

**Requirement:** NFR-005

**Then** 扫描 `src/` 下 `.ts`、`.tsx`、`.css`、`.html`，没有替换字符 U+FFFD 和常见 GBK 误解码字形组合。

**Verification:** automated · `src/tests/encoding.test.ts`

**Status:** NOT RUN

## AC-034 — Storage 默认拒绝

**Requirement:** NFR-006

**Then** `storage.rules` 只有一条 `allow read, write: if false` 规则。

**Verification:** inspection

**Status:** NOT RUN
