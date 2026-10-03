# ITEI 设计系统 — 给 AI 编码工具的使用说明

本目录是机械工业仪器仪表综合技术经济研究所（ITEI）的跨端视觉规范，从所内 PPT 模板提炼。任何为 ITEI 生成网站、桌面应用、手机 App、小程序、内部工具或图表的任务，先按下面顺序读文件，再动手。

## 读取顺序

1. `README.md` — 品牌手册：内容基调、颜色、字体、形状与布局、图标、交互状态。规则里直接点名 token。
2. `platforms.md` — 网站 / 桌面 / App / 小程序 / 内部工具 / 图表各自的骨架映射。
3. `tokens.css` — 已编译的 CSS 变量与文字样式类，Web 项目直接引入。
4. `tokens.json` — 完整 token 定义（含每个 token 的用途与对比度说明）；`tokens.flat.json` — 浅/深两主题已解析成十六进制的扁平版，供 Flutter、SwiftUI、Compose、小程序 wxss、Python 绘图等非 CSS 环境。
5. `components/<Name>/README.md` — 各组件的使用规则；`components/<Name>/preview.html` — 参考实现（纯 HTML/CSS，依赖 tokens.css）。
6. `assets/Logo/itei-logo.png` — 标志（透明底）；`assets/Templates/` — PPT 原始背景图，仅供参考形态。

## 硬性规则（缩写版，细则见 README.md）

- 底色 `--surface` 白，分层靠 1px `--border`，不用投影做分层，不用圆角卡片（`--radius-none` 为默认，控件最多 2px）。
- 大面积品牌色只有 `--brand-navy`；`--brand-red` 每屏至多一处，只表示「当前项 / 强调 / 危险」；`--brand-sky` 只做线条与装饰，文字链接用 `--link`。
- 唯一允许的渐变：页眉 `linear-gradient(90deg, var(--gradient-start), var(--gradient-end))`。
- 品牌形状是 45° 斜切：`clip-path: polygon(0 0, 100% 0, calc(100% - var(--slash)) 100%, 0 100%)`，偏移 `--slash` = 24px。
- 字体 `--font-sans`（微软雅黑栈），不引入 Inter / Roboto；衬线 `--font-display` 只在封面出现一次。
- 章节编号是排版的一部分（「一、」「1.1」「01」），不换成图标。
- 状态色必须配文字或图标；错误态必须有「错误」字样（红色与「当前项」同色）。
- 焦点环 `--focus` 2px 实线 + 2px 偏移；动效只用 120–200ms opacity / transform。
- 图标：Tabler Icons，单色线性，`currentColor`；不用 emoji。
- 深色主题：`[data-theme="dark"]` 或系统偏好自动切换；深色下 `--brand-navy` / `--brand-red` 已提亮，其上文字用 `--on-brand`，不要写死白色。

## 各工具接入

- **Claude Code / Codex / Gemini CLI / Antigravity**：把本目录放进仓库（建议 `design/itei/`），本文件会被自动读取；或在项目的 CLAUDE.md / AGENTS.md / GEMINI.md 里加一行「UI 规范见 design/itei/AGENTS.md」。
- **ChatGPT / Gemini / Claude 网页对话**：上传 `README.md`、`tokens.css`、`platforms.md` 三个文件，再粘贴 `prompt-snippet.txt` 的内容作为开场指令。
- **Tailwind 项目**：`presets: [require('./tailwind.preset.js')]` 并 `@import "tokens.css"`。
- **Claude Design System 画板**：原始画板在 claude.ai 的 Artifacts 里（标题 ITEI），可读取实时版本。
