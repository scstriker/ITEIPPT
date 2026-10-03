# DataTable
面向统计数据与台账的表格。表头 `surface-sunken` 底、`brand-navy` 文字、下沿 2px `brand-sky`；行线 1px `border`，偶数行 `surface-sunken`，无竖线。

**使用者提供**：`columns[]`（`key`、`title`、`align`、`type`：text / number / code / status）、`rows[]`、可选 `dense`。

**规则**
- 数字列右对齐、等宽数字（`font-variant-numeric: tabular-nums`）、千分位；编码列用 `code` 样式。
- 单元格内边距 `space-2` × `space-3`；`dense` 模式用 `body-sm` 并把纵向内边距降到 `space-1`。
- 状态列放 Tag（sm，高 20px），不放彩色文字。
- 表宽超过容器时横向滚动并固定首列；手机端把表改为卡片列表，不缩小字号。
- 排序图标、筛选图标用 Tabler 16px `ink-muted`。

**不要**：竖线；表头用深蓝实色底（那是导航的语言）；单元格里放按钮以外的交互控件。
