# Footer
两种页脚。应用页脚（深蓝条）对应 PPT 内容页底栏：左日期 / 中机构 / 右页码，右端叠一块 `brand-sky` + `brand-navy-deep` 的斜切装饰。网站页脚（白底）对应结束页联系信息：顶部一条 `brand-sky` 2px 线，`caption` 灰字。

**使用者提供**：应用页脚 `left` `center` `right` 三段文字；网站页脚 `org`（全称）、`contact`（地址 / 电话 / 网址）、`copyright`。

**规则**
- 应用页脚高 40px，`caption` 样式，`on-brand` 文字；斜切装饰宽 120px，只在右端，不与文字重叠（右段留 96px）。
- 网站页脚上边线 `border-rule` 2px `brand-sky`；机构全称 `ink` 13px 加粗，其余 `ink-muted` 12px。
- 手机端与小程序不放应用页脚，改用 TabBar；网站页脚保留。

**不要**：把页脚做成渐变（渐变只属于 AppHeader）；在页脚放主要操作按钮。
