# KpiTile
统计数字卡。大数字用 `numeral` 样式 `brand-navy`，标签与说明用 `ink-muted`，趋势带箭头字符与颜色。

**使用者提供**：`label`、`value`、`unit`、`delta`（文字，含方向）、`tone`（up / down / neutral）、`highlight`（顶部红条，一组里至多一块）。

**规则**
- 与 Card 同一套底与边（`surface-raised` + `border`，直角），内边距 `space-4`，元素间距 `space-1`。
- 趋势颜色：上升 `success`、下降 `brand-red`，并带 ▲ ▼ 字符；语义上「下降」不总是坏事，文案要说清（「▼ 需本周处理」）。
- `highlight` 用顶部 `border-accent` 4px `brand-red`，是 KPI 组里的「当前项」。
- 一行 3–4 块，手机端 2 块。

**不要**：数字用渐变或彩色；在同一组里出现两块红条；放迷你图以外的图表。
