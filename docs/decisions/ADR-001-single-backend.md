# ADR-001 — 后端只保留一份实现，本地用内存任务存储

**Status:** Accepted

**Date:** 2026-10-03

## Context

重构前有两份后端：`src/services/apiProxyServer.ts`（本地开发用）和 `functions/src/services/apiProxyServer.ts`（线上）。两份已分叉 612 行。前端调用的任务接口 `/api/generate-content/jobs` 只在线上版存在，本地无法生成内容。线上版的任务依赖 Firestore、Cloud Storage 和 Pub/Sub，本地没有这些服务。

## Decision

- 以线上版为准，后端代码只保留在 `functions/src/`，按 gemini / plan / content / jobs / http 拆分模块。
- 任务存储和执行抽象成两个接口：`JobStore`（创建、读、更新进度、写结果、清理）和 `JobRunner`（把任务交给 worker）。
- 线上装配 Firestore + Storage 的 `JobStore` 和 Pub/Sub 的 `JobRunner`；本地装配内存 `JobStore` 和进程内 `JobRunner`。
- 本地入口 `functions/src/dev/localServer.ts`，由 `src` 下的 `npm run proxy:dev` 启动，继续读 `src/.env`。
- 前后端共享的类型放 `functions/src/contracts/`，前端经路径别名只引用类型。

## Alternatives Considered

### 用 Firebase 模拟器跑本地

需要安装 Java 和 Firebase CLI，启动慢，开发者每次调试都要起 4 个模拟器。

### npm workspaces 抽出独立的 shared 包

Firebase 部署只上传 `functions/` 目录，workspace 依赖不会一起上传，需要额外打包步骤。

## Consequences

### Positive

- 本地和线上走同一套业务代码，不再漂移。
- 本地不依赖 Firebase 即可完整运行和测试。

### Negative / Trade-offs

- 本地任务在进程重启后丢失。
- 前端通过相对路径引用 `functions/src/contracts/`，两个工程在目录上有耦合。

## References

- `docs/TECH_SPEC.md` 第 3 节
