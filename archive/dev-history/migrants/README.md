# ITEIPPT Migration Pack

> 更新时间：2026-04-12
> 目的：让新接手同学在一个窗口内完成“本地运行 + 云端现状 + 下一步动作”。

## 先读这 4 份
1. [`01-current-progress.md`](./01-current-progress.md)
2. [`03-local-runbook.md`](./03-local-runbook.md)
3. [`06-cloud-production-status.md`](./06-cloud-production-status.md)
4. [`05-handoff-checklist.md`](./05-handoff-checklist.md)

## 当前结论（2026-04-12）
- 本地最小闭环已验证：`src` 前端 + `src` 本地代理后端 + 导出流程可跑通。
- 云端已上线：`Hosting + Functions` 已部署并可访问。
- 默认 Firebase 项目：`iteippt-cloud-260412-4205`（旧项目保留为 `legacy`）。
- `GEMINI_API_KEY` 已迁移到 Firebase Secret Manager，不再放在 `functions/.env`。
- Firebase Storage 尚未初始化，因此 `firebase deploy --only storage` 仍会失败。

## 云端入口
- 前端：`https://iteippt-cloud-260412-4205.web.app`
- API 健康检查：`https://iteippt-cloud-260412-4205.web.app/api/health`
- Functions URL：`https://asia-east1-iteippt-cloud-260412-4205.cloudfunctions.net/api`

## 迁移包文件说明（7 份）
- `README.md`：迁移包总览与入口
- `01-current-progress.md`：当前完成度 + 已验证结果
- `02-repo-analysis.md`：结构、链路、关键模块
- `03-local-runbook.md`：本地启动与排障
- `04-risks-and-next-actions.md`：风险优先级 + 下一步
- `05-handoff-checklist.md`：接手验收清单
- `06-cloud-production-status.md`：云端现网状态 + Storage 补齐步骤

## 仓库内权威来源
- `docs/cloud-deployment.md`
- `scripts/cloud-preflight.ps1`
- `.firebaserc`
- `firebase.json`

## 重要提醒
- 当前仓库为高脏工作区（大量 `A/AM/??`），接手前先做快照分支。
- `cloud-preflight.ps1` 当前不会阻断 “Storage 未初始化”，部署前仍需人工确认。
- 如面向中国大陆用户，需要先做可达性验证与降级方案（详见 `04-risks-and-next-actions.md`）。
