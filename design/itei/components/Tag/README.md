# Tag
状态与分类标签。五种状态各带一个色点和文字；分类标签用深蓝实色。

**使用者提供**：`tone`（neutral / info / success / warning / danger / brand）、`children`（2–4 个字）。

**规则**
- 高 24px，横向内边距 `space-2`，`label` 样式，圆角 `radius-sm`。
- 状态色用 `*-bg` 浅底 + 对应前景色（`link` `success` `warning` `brand-red`），前景在浅底上 ≥4.5:1。
- 色点 6px `radius-pill`，是全站少数圆形元素之一。
- danger 与 warning 文案要能独立读懂（「已驳回」而非「异常」）。

**不要**：胶囊形；可点击的 Tag（要交互用 Button sm 或 Chip）；同一列表混用超过 3 种 tone。
