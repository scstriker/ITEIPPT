机械工业仪器仪表综合技术经济研究所（ITEI）的跨端视觉语言：从所内 PPT 模板提炼，供网站、桌面应用、手机 App、小程序与内部工具共用。核心印象是「深蓝主色 + 一点红 + 白底 + 45° 斜切」：庄重、克制、有工程感。

## 内容基调

- 语气：机构化、陈述式、第三人称。称呼用「本所」「用户」，不用「我们」「你」；不用感叹号，不用 emoji。
- 中文优先。界面中文用全角标点；数字、编码、单位用半角并与汉字之间留一个空格（「累计收到相关产品信息 200 余份」「HS 9018.90」）。
- 标题层级沿用公文编号：章用「一、」，节用「1.1」，条目用「01 02 03」。导航与目录直接复用这套编号，不另造图标体系。
- 全称一次、简称到底：首次出现写「机械工业仪器仪表综合技术经济研究所（ITEI）」，此后写「ITEI」或「本所」。
- 状态与反馈用短语不用句子：「已提交」「审核中」「导出完成」。错误信息说明原因和下一步：「文件超过 20 MB，请压缩后重试」。

## 颜色

- 页面底色只用 `surface`；分层靠 `border`（1px）与 `surface-sunken`，不靠投影。卡片是 `surface-raised` + `border`，`shadow-raised` 只给悬浮层。
- `brand-navy` 是唯一的大面积品牌色：AppHeader、Footer、主按钮、当前章节标题。同一屏出现两块以上的 navy 实色块时，把其余降为 `info-bg` 底 + `brand-navy` 文字。
- `brand-red` 只做「当前项 / 强调 / 危险」，每屏至多一处大面积（目录当前条、主 CTA 旁的次要红色文字、删除按钮）。红蓝并置是品牌识别的一部分（标志即蓝弧 + 红椭圆），但红永远是小的那块。
- `brand-sky` 是线条色，不是文字色：标题下横线、进度条、图表第二序列、斜切装饰。文字链接用 `link`（浅色 5.6:1）。
- 页眉横幅背景用 `gradient-start` → `gradient-end` 的水平线性渐变（`linear-gradient(90deg, var(--gradient-start), var(--gradient-end))`），其上文字用 `on-gradient`。这个渐变两个主题相同，是模板母版顶部波带的直接映射；除此之外不再使用任何渐变。
- 深色主题里 `brand-navy` 与 `brand-red` 已被提亮，其上文字改用 `on-brand`（深墨色），不要写死白色。
- 状态色 `success` `warning` `danger` `info` 一律配文字或图标。`danger` 复用 `brand-red`，因此错误态必须带「错误」字样或图标，避免与「当前项」混淆。
- PowerPoint 主题自带的 Office 默认色（5B9BD5、ED7D31、70AD47 等）不属于品牌，图表序列按 `chart-1`…`chart-5` 取。

## 字体与排版

- 全部界面文字用 `sans`（微软雅黑及其跨平台回退）。不引入 Inter、Roboto 一类西文字体，英文与数字随中文字体走。
- `display` 只在封面 / 欢迎页 / 结束页出现一次（模板结束页「谢谢！」用汉仪粗宋 94pt），对应样式 `display-hero`。正文与标题从不使用衬线。
- 层级：`title-page` 32 → `title-section` 24 → `title-sub` 18 → `title-nav` 16；正文 `body` 15 / 行高 24，长文 `body-lg` 17 / 行高 28（模板正文行距 1.6）。小于 12px 的文字不允许。
- 编号是排版的一部分：章节标题保留「一、」「1.1」前缀；序号用 `numeral` 样式放在色块里（见 NumberedNav）。
- 段落左对齐，标题左对齐；只有封面标题与「目录」二字居中（模板如此）。

## 形状与布局

- 直角是默认（`radius-none`），控件最多 `radius-sm` 2px。圆角只用于头像与状态小圆点（`radius-pill`）。
- 品牌形状是 45° 斜切：`clip-path: polygon(0 0, 100% 0, calc(100% - var(--slash)) 100%, 0 100%)`，偏移量固定为 `slash`（24px）。用在 SectionTitle 的色块右端、NumberedNav 序号块右端、Footer 右侧装饰。一个组件只切一个角，不切两个。
- 标题下横线：`border-rule`（2px）`brand-sky`，宽度跟随内容不撑满（模板封面副标题上方的横线）。
- 4px 基准网格：`space-1`…`space-8`。手机侧边距 `space-4`，桌面侧边距 `space-6`，内容最大宽 `content-max`（1200px）居中。
- 页面骨架：顶部 `header-height`（56px）AppHeader 固定，底部 Footer 深蓝条（网页与桌面端）或 TabBar（手机端与小程序）；中间白底内容区。AppHeader 左侧放标志、右侧放当前页标题，对应模板内容页页眉。
- 表格：表头 `surface-sunken` + `title-nav` 文字 `brand-navy`，行线 `border` 1px，斑马行 `surface-sunken`，无竖线。

## 图标与图片

- 标志使用 `assets/Logo/itei-logo.png`（蓝弧 + 红椭圆 + ITEI 字样，透明底）。放在白底或 `surface-sunken` 上，最小高度 24px，左右留 `space-3`。不要放在深蓝底上（红椭圆与蓝弧会失去对比）；深蓝页眉里用 `on-gradient` 白色纯文字「ITEI」代替。
- 图标系统：单色线性图标，2px 描边，取自 [Tabler Icons](https://tabler.io/icons)（MIT），颜色跟随文字（`currentColor`）；模板自身没有图标体系，这是新增约定。不用 emoji，不用彩色插画图标。
- 数据图表颜色按 `chart-1`…`chart-5`，网格线 `border`，坐标文字 `ink-muted` `caption`。
- `assets/Templates/` 里是模板母版与封面版式的原始背景图（4:3 像素，PPT 中拉伸为 16:9），供做幻灯片或海报时参考波带与斜切的形态，不直接用于 UI。

## 交互状态

- 悬停：主按钮 `brand-navy` → `brand-navy-deep`；文字链接加下划线。
- 按下：颜色同悬停，位移 1px 或不位移，不做缩放动画。
- 焦点：`focus` 2px 实线环，`outline-offset: 2px`，所有可交互元素统一。
- 禁用：文字 `ink-disabled`，底 `surface-sunken`，边 `border`。
- 动效：只用 120–200ms 的 opacity / transform 过渡，`ease-out`。不用弹跳、不用渐变流动。
