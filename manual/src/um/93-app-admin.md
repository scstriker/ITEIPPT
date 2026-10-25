# 管理员配置 {#app-um-admin .appendix}

本附录供部署和维护 ITEISlides 的系统管理员查阅。架构和接口说明见技术规格说明[#6]，完整的部署步骤见云端部署手册[#7]。

## 部署组成

线上环境部署在 Firebase 上，组成见[@tbl-um-admin-parts]。

Table: 线上环境的组成 {#tbl-um-admin-parts cols=28,72}

| 组件 | 作用 |
|---|---|
| Firebase Hosting | 提供前端页面，把 /api/** 的请求转给云函数 api |
| 云函数 api | HTTP 接口：规划框架、创建和查询生成任务。区域 asia-east1，超时 600 秒 |
| 云函数 generationJobWorker | 从 Pub/Sub 主题接收任务并执行内容生成，超时 540 秒 |
| 云函数 generationJobCleanup | 每 24 小时运行一次，删除超过 72 小时的任务 |
| Firestore 集合 generationJobs | 保存任务状态和进度 |
| Cloud Storage 存储桶 | 保存任务的请求和结果 JSON |

## 配置项

后端从环境变量读取配置，见[@tbl-um-admin-env]。线上环境的 GEMINI_API_KEY 放在 Secret Manager 中，其余写在 functions/.env；本地开发时都写在 src/.env。

Table: 后端配置项 {#tbl-um-admin-env cols=30,12,58}

| 配置项 | 必填 | 说明 |
|---|---|---|
| GEMINI_API_KEY | 是 | 调用 Gemini 的密钥。缺少时，两个 AI 操作都报错；无效时界面不报错，只表现为降级 |
| GEMINI_PLAN_MODEL | 否 | AI 建议调整使用的模型，默认 gemini-2.5-flash |
| GEMINI_CONTENT_MODEL | 否 | 生成内容使用的模型，默认 gemini-2.5-flash |
| GEMINI_BASE_URL | 否 | Gemini 接口地址，默认为 Google 的公开地址 |
| GENERATION_JOB_BUCKET | 线上必填 | 保存任务请求和结果的存储桶 |
| GENERATION_JOB_TOPIC | 否 | 任务消息的 Pub/Sub 主题，默认 iteippt-generation-content-jobs |
| API_PROXY_PORT | 否 | 本地后端的端口，默认 8787 |

不要把密钥写进代码仓库，也不要通过聊天工具或邮件明文传递。

## 系统限制

[@tbl-um-admin-limits] 汇总代码中的固定限制，修改需要改代码并重新部署。

Table: 系统的固定限制 {#tbl-um-admin-limits cols=40,22,38}

| 项目 | 值 | 位置 |
|---|---|---|
| 上传文档的大小 | 20 MB | 前端 |
| 文档解析时限 | 45 秒 | 前端 |
| 导入图片的大小 | 每张 12 MB | 前端 |
| 每章子章节数 | 1～20 | 前端 |
| 正文字数提醒阈值 | 150 个字符 | 前端 |
| 导出时的章节上限 | 6 章 | PPTX 模板 |
| 查询任务进度的间隔 / 最长等待 | 2 秒 / 20 分钟 | 前端 |
| 请求体大小 | 8 MB | 后端 |
| AI 建议调整使用的文档长度 | 前 120,000 个字符 | 后端 |
| 生成内容使用的文档长度 | 前 180,000 个字符 | 后端 |
| 每批正文页数 | 4 页 | 后端 |
| 每批请求中的文档节选 | 36,000 个字符，重试时 8,000 个字符 | 后端 |
| 改用规则补写的时间点 | 任务开始后约 480 秒 | 后端 |
| 任务保存时间 | 72 小时 | 后端 |

## 检查服务状态

后端提供健康检查接口。在浏览器中打开下面的地址，返回 ok 为 true 的 JSON 即表示后端在运行：

```text
https://<ITEISlides 的域名>/api/health
```

后端只处理健康检查、规划框架和生成任务这几组接口，访问其他 /api/ 路径返回 404。

健康检查不调用 Gemini，不能说明密钥有效。判断密钥是否有效，在 ITEISlides 中上传任意一份文档，执行一次 AI 建议调整：如果每章的理由都是“已基于章节标题……生成默认分析……”，就要在 Google 的控制台中检查密钥状态和额度。

## 本地运行

开发和排查问题时，可以在本机运行完整系统。需要 Node.js 22。第一次运行前，在仓库的 functions 和 src 目录下分别执行 npm install，并在 src/.env 中写入 GEMINI_API_KEY。然后在 src 目录下打开两个终端，分别运行：

```text
npm run proxy:dev
npm run dev
```

然后在浏览器中打开 http://localhost:3000。本地后端用内存保存任务，进程退出后任务记录随之清除。
