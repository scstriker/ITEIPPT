# ADR-003 — 前端技术栈对齐约定，Firebase SDK 暂不升级

**Status:** Accepted

**Date:** 2026-10-03

## Context

约定的 Web 技术栈是 React 19、TypeScript 7、Vite 8、Tailwind CSS 4 和 shadcn/ui，界面遵循 ITEI 设计规范。重构前前端是 TypeScript 5.8、Vite 6，样式为 2446 行手写 CSS，Tailwind 已安装未接入，没有 shadcn/ui。用户在本次重构中选择对齐技术栈并改用 ITEI 界面。

## Decision

- 前端升级到 TypeScript 7、Vite 8、`@vitejs/plugin-react` 6，接入 Tailwind CSS 4 和 shadcn/ui。
- shadcn/ui 主题变量映射到 ITEI token；图标用 Tabler Icons（ITEI 规定），不用 shadcn 默认的 lucide。
- functions 同步升级到 TypeScript 7，输出仍为 CommonJS。
- 测试用 Vitest（前后端）和 Playwright（端到端）。
- `firebase-functions`、`firebase-admin`、`pdfjs-dist` 主版本和 Functions 运行时 `nodejs20` 本次不动。

## Alternatives Considered

### 保持现有版本，只换 ITEI 配色

改动最小，但与约定长期不一致，后续项目无法复用组件写法。

### 同时升级 Firebase SDK 和运行时

需要真实部署才能验证，超出本次“只改代码、不部署”的范围。

## Consequences

### Positive

- 与其他 ITEI 项目共用一套组件和样式写法。

### Negative / Trade-offs

- 界面外观变化，现行手册截图过时。
- `nodejs20` 运行时的平台支持期限需要另行核实。

## References

- `TechStack/webapp.md`
- `design/itei/AGENTS.md`
