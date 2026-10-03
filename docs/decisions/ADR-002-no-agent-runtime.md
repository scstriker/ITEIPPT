# ADR-002 — 不引入 Pi Agent 等 Agent 运行时

**Status:** Accepted

**Date:** 2026-10-03

## Context

项目约定“涉及 AI Agent 时默认基于 Pi Agent 开发”。本系统调用 Gemini 做两件事：规划章节、按批生成逐页内容。每次调用都是一次性的结构化生成：固定提示词，要求返回 JSON，后端解析校验。没有多轮对话，没有工具调用，没有让模型自行决定下一步的循环。

## Decision

不引入 Pi Agent 或其他 Agent 运行时。继续用 `fetch` 直接调 Gemini REST 接口，封装在 `functions/src/gemini/`。

## Alternatives Considered

### 改用 Pi Agent

要把固定流程改写成 Agent Loop 和 Tool。流程本身是确定的，改写后行为更难预测，测试也要处理模型自主决策的分支。

### 改用 `@google/genai` 官方 SDK

前端曾安装但未使用。换 SDK 不改变行为，本次重构不做。

## Consequences

### Positive

- 行为确定，用本地 HTTP 桩即可测试。

### Negative / Trade-offs

- 以后若需要多轮澄清或工具调用（如联网检索标准原文），需重新评估，届时按约定用 Pi Agent。

## References

- `TechStack/AI Agent.md`
