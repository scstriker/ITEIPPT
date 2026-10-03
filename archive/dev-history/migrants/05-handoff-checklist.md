# 05 - Handoff Checklist

## 迁移执行清单

### 环境与启动
- [ ] 安装 Node.js 20+
- [ ] `src` 执行 `npm install`
- [ ] `functions` 执行 `npm install`
- [ ] 配置 `src/.env`（至少 `GEMINI_API_KEY`）
- [ ] 启动 `src` 代理：`npm run proxy:dev`
- [ ] 启动 `src` 前端：`npm run dev`
- [ ] 打开 `http://localhost:3000`

### 基础门禁
- [ ] `src`: `npm run lint`
- [ ] `src`: `npm run build`
- [ ] `src`: `npm run proxy:smoke`
- [ ] `functions`: `npm run build`

### 功能冒烟（按最新改造点）
- [ ] Step1 上传后，标题/机构回填到封面与结束页
- [ ] Step2 主表为 5 列（序号/章节名称/子章节数/内容/删除）
- [ ] Step2 子表为 5 列（序号/子章节名称/布局提示/内容/删除）
- [ ] Step2 点击箭头直接展开子章节，行尾 `X` 删除有效
- [ ] Step2 子章节编号显示 `1-1/1-2`，新增删除后连续重排
- [ ] Step3 显示两种导入方式说明（ITEI Draw + 本地上传）
- [ ] Step3 批量按钮文案为“批量导入图片”
- [ ] Step3 页面右侧中部悬浮 `ITEI DRAW` 按钮可跳转
- [ ] 内容页二级标题蓝底可随标题长度自适应（不压正文）
- [ ] 正文高亮为短语/整句语义片段，不出现随机碎片着色
- [ ] 审计页可编辑并成功导出 PPTX

### 文档同步
- [ ] 已阅读 `migrants/01-current-progress.md`
- [ ] 已阅读 `migrants/02-repo-analysis.md`
- [ ] 已阅读 `migrants/04-risks-and-next-actions.md`
- [ ] 已对照 `docs/phase_progress.md` 与当前代码确认状态

### 可选（云函数本地模拟/部署）
- [ ] `functions`: `npm run serve`（需 Firebase CLI）
- [ ] 按 `docs/deployment-guide-v4.md` 执行部署
