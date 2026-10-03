# Input
表单控件：文本框、下拉、日期，同一套边线与状态。

**使用者提供**：`label`、`required`、`value`、`placeholder`、`help`（说明或错误文案）、`state`（default / error / disabled）。

**规则**
- 高 40px，横向内边距 `space-3`，圆角 `radius-sm`，文字 `body`，标签 `label` 样式在上方，间距 6px。
- 默认边 `border-strong`（3:1，承载信息）；焦点：边变 `brand-navy` + `focus` 环；错误：边与说明文字变 `brand-red` 且说明以「✕ 错误：」开头（红色同时是「当前项」色，必须有字样）。
- 必填星号 `brand-red`。
- 禁用：`surface-sunken` 底、`ink-disabled` 文字、`border` 边，并在说明中写明原因。
- 手机端与小程序：高度 44px，标签仍在上方。

**不要**：内嵌标签（placeholder 当 label）；圆角胶囊输入框；只用颜色表达错误。
