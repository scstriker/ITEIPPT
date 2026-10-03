# 跨端落地

同一套 token 在五类载体上的映射。原则：颜色、字号、间距、形状不变，变的只有骨架与密度。

| 载体 | 骨架 | 侧边距 / 密度 | 特有约定 |
| --- | --- | --- | --- |
| 网站（官网、门户） | AppHeader 吸顶 + 内容区 `content-max` 居中 + 网站页脚 | `space-6`；正文 `body-lg` | 首屏可用 `display-hero` 一次；封面式 Hero 用 AppHeader 同款渐变，其下一条 `brand-sky` 线 |
| 桌面应用（Electron / Tauri / WPF） | AppHeader（可含窗口操作）+ 左侧 240px 导航（`surface-sunken`）+ 内容区 | `space-5`；表格默认 `dense` | 左侧导航当前项：`info-bg` 底 + 左 `border-accent` `brand-navy`（不是红，红留给内容区的当前项） |
| 手机 App（iOS / Android） | 顶栏 56px 渐变（AppHeader 去掉 nav）+ 内容 + 底部 TabBar 5 项以内 | `space-4`；控件高 44px | TabBar 当前项 `brand-navy` 图标 + 文字，非当前 `ink-muted`；不用红 |
| 微信 / 支付宝小程序 | 原生导航栏：背景 `gradient-end`（#004070，小程序导航栏不支持渐变）、前景白 | `space-4`；控件高 44px | 首页允许一个 NumberedNav 作功能入口；胶囊按钮位置留白 |
| 内部工具（Streamlit、Gradio、Tampermonkey 面板） | 只取 token：`tokens.css` 注入 + `brand-navy` 主按钮 + `body` 字号 | 跟随宿主 | 不追求 AppHeader，保证颜色与字体一致即可 |

## 图表（Matplotlib / ECharts / Plotly）

- 序列色顺序：`chart-1` 深蓝 → `chart-2` 亮蓝 → `chart-3` 红 → `chart-4` 灰蓝 → `chart-5` 琥珀。
- 网格线 `border`，坐标文字 `ink-muted` 12px，标题 `title-sub` 左对齐，不用图表内标题居中。
- 单序列图表只用 `chart-1`；需要强调一个柱子时该柱用 `chart-3`（同 NumberedNav 的「当前项为红」逻辑）。

## 文档与幻灯片

- PPT 沿用所内模板本身；本系统的 token 用于在网页里「像 PPT 一样」呈现（SectionTitle 一级 = 页眉标题，NumberedNav = 目录页）。
- Word / PDF 报告：标题 `brand-navy`，一级标题下 2px `brand-sky` 线，正文黑色宋体不受本系统约束（公文规范优先）。
