# Button
直角按钮，四种语义、两种尺寸。主按钮是深蓝实色，次按钮是深蓝描边，危险按钮是品牌红，文字按钮用链接色。

**使用者提供**：`variant`（primary / secondary / danger / ghost）、`size`（md 40px / sm 32px）、`disabled`、`children`、可选前置图标（Tabler，18px，`currentColor`）。

**规则**
- 一组操作里只有一个 primary；danger 不与 primary 并列在同一侧，放到左边或菜单里。
- 圆角 `radius-sm`（2px），内边距横向 `space-5` / 纵向 0，高度固定，文字 `button` 样式。
- 悬停：primary → `brand-navy-deep`；secondary → `info-bg` 底；ghost 加下划线。按下不缩放。
- 焦点环 `focus` 2px，`outline-offset` 2px，四种变体相同。
- 禁用：`surface-sunken` 底、`ink-disabled` 文字、`border` 边。

**不要**：渐变底、圆角胶囊、投影；在 `brand-navy` 底的页眉里用 primary（改用 secondary 反白：`on-gradient` 描边与文字）。
