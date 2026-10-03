# SectionTitle
三级内容标题，编号是标题的一部分：章「一、」放在深蓝斜切块里，节「1.1」加亮蓝下划线，小节用红色左侧指示条。

**使用者提供**：`level`（1 / 2 / 3）、`number`（「一」「1.1」，可空）、`text`。

**规则**
- 一级：`brand-navy` 底 + `on-brand` 文字，`title-section` 样式，右端斜切 `slash`；一页只出现一次，通常紧接 AppHeader 之下或作为页面 H1。
- 二级：`title-sub` 样式，编号 `brand-navy`，底线 `border-rule` 2px `brand-sky`，宽度跟随文字。
- 三级：`title-nav` 样式 `brand-navy` 文字，左侧 `border-accent` 4px `brand-red`；这是全站唯一允许「左侧色条」的地方，卡片不用。
- 标题左对齐，不居中。

**不要**：跳级使用；给一级标题加圆角或投影；把编号拆成独立图标。
