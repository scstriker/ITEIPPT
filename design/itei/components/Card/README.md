# Card
直角内容卡片，靠 1px `border` 与页面分层；只有悬浮/可拖动的卡片才用 `shadow-raised`。

**使用者提供**：`title`（可选，`title-nav` 样式 `brand-navy`）、`meta`（可选，`caption` `ink-muted`）、`children`、`footer`（可选，操作靠右）。

**规则**
- 底 `surface-raised`，边 `border`，圆角 `radius-none`；内边距 `space-4`，标题栏与页脚栏各有一条 `border` 分隔线。
- 卡片间距 `space-5`；放在 `surface-sunken` 区域里对比更清楚，放在 `surface` 上则靠边线。
- 标题是 `brand-navy` 的唯一位置；正文 `ink`；链接 `link`。

**不要**：左侧彩色竖条（那是 SectionTitle 三级的专属）；圆角 + 大投影的「悬浮卡」风格；卡片里再嵌卡片。
