# AppHeader
页面顶部固定页眉，对应 PPT 内容页母版的深蓝波带：左侧白底标志区以 45° 斜切收尾，右侧渐变蓝底放当前页标题与主导航，下沿一条 `brand-sky` 细线。

**使用者提供**：`title`（当前页/章节名，用 `title-section` 语义但缩到 20px）、`nav[]`（≤5 项，`aria-current` 标当前项）、可选 `actions`（用户菜单、搜索）。

**规则**
- 高度固定 `header-height`（56px），桌面与手机相同；手机端隐藏 nav，改为底部 TabBar。
- 背景只用 `gradient-start`→`gradient-end` 水平渐变，文字 `on-gradient`；两个主题相同，不随暗色模式变化。
- 标志区是白底（`surface`），放真实标志 `assets/Logo/itei-logo.png`（高 28px）；预览中的标志由 CSS 近似，正式实现必须用 PNG。
- 标志区右端斜切偏移 `slash`（24px），全站只有页眉与页脚有斜切标志区，卡片不用。
- 当前导航项用 2px 下划线（`on-gradient`），不用底色块。

**不要**：把页眉做成白底加阴影；在页眉里放搜索框以外的输入控件；在深蓝底上直接放彩色标志。
