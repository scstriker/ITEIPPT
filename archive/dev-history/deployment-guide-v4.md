# ITEIPPT v2.0 部署教程

| 项目 | 内容 |
|------|------|
| 更新日期 | 2026-04-10 |
| 适用人群 | 完全不懂部署的小白 |
| 部署方式 | **本地双进程**（推荐）或 Firebase 全栈云部署 |
| 预计耗时 | 首次约 30 分钟 |

---

## 你的电脑长什么样？（架构图看不懂跳过）

```
你的电脑
├── 终端窗口 A：API 代理服务（帮你的网页和 AI 通话）── 端口 8787
├── 终端窗口 B：前端网页服务（你在浏览器里操作的界面）── 端口 3000
│
│   浏览器打开 http://localhost:3000
│       ↓ 点击按钮
│       → 网页把请求发给 localhost:8787
│           → 代理服务拿着你的 API Key 去问 Gemini AI
│               → AI 回答 → 代理转发回网页 → 你看到结果
│
└── 最终产出：一个 .pptx 文件下载到你的电脑
```

---

## 第零步：检查你电脑上有没有这些东西

在开始之前，你要确保电脑上已经装了以下软件。打开 PowerShell（按 `Win + R`，输入 `powershell`，回车），依次输入以下命令检查：

```powershell
node -v
```
如果显示 `v20.x.x` 或更高版本的数字，说明 Node.js 已安装。**如果报错**，去这个网站下载安装：https://nodejs.org （选 LTS 版本，一路下一步就行）

```powershell
npm -v
```
如果显示数字，说明 npm 已安装（npm 随 Node.js 自动安装的，不用单独装）。

---

## 第一步：拿到 Gemini API Key（你的 AI 钥匙）

API Key 是一串密码，让你的程序有权限调用 Google 的 AI。免费的。

1. 用浏览器打开 https://aistudio.google.com/
2. 用你的 **Google 账号**登录（就是 Gmail 邮箱）
3. 登录后，点左边菜单的 **Get API Key**
4. 点 **Create API key**
5. 如果它问你选哪个项目，随便选一个或者点"新建项目"
6. 屏幕上会出现一串类似 `AIzaSyB-xxxxxxxxxxxx` 的文字 —— **这就是你的 Key**
7. **复制这串文字，粘贴到记事本里暂存**，后面要用

> ⚠️ **这串 Key 不能发到微信群里、不能放到代码仓库里、不能告诉别人。** 泄露了别人可以用你的额度。

---

## 第二步：把代码弄到你电脑上

如果你已经有项目文件夹了（`c:\Users\61973\Documents\cc-projects\ITEIPPT`），**跳过这步**。

如果没有，找你的同事要代码，或者用 Git 克隆：
```powershell
cd c:\Users\61973\Documents\cc-projects
git clone <仓库地址> ITEIPPT
```

---

## 第三步：配置 API Key（最关键的一步）

1. 用文件管理器打开 `c:\Users\61973\Documents\cc-projects\ITEIPPT\src\` 文件夹
2. 你会看到一个叫 `.env.example` 的文件
3. **复制**这个文件，把副本改名为 `.env`（注意：文件名就是 `.env`，前面有个点，没有后缀）
4. 用记事本打开这个 `.env` 文件，你会看到：

```
GEMINI_API_KEY="MY_GEMINI_API_KEY"
API_PROXY_PORT="8787"
API_PROXY_TARGET="http://127.0.0.1:8787"
GEMINI_BASE_URL="https://generativelanguage.googleapis.com/v1beta"
GEMINI_PLAN_MODEL="gemini-2.5-flash"
GEMINI_CONTENT_MODEL="gemini-2.5-flash"
```

5. 把第一行的 `MY_GEMINI_API_KEY` 替换成你刚才复制的那串 Key。改完后长这样：

```
GEMINI_API_KEY="AIzaSyB-你的真实Key"
```

6. **其他行不要动！** 保存，关闭记事本。

> 💡 如果 Windows 不让你创建 `.env` 文件（说文件名不合法），在 PowerShell 里执行：
> ```powershell
> cd c:\Users\61973\Documents\cc-projects\ITEIPPT\src
> copy .env.example .env
> ```

---

## 第四步：安装依赖包（让程序需要的零件就位）

打开一个 **PowerShell 窗口**，输入：

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT\src
npm install
```

这一步会下载一堆程序依赖。**第一次执行大约需要 1-3 分钟**，屏幕上会刷很多行文字，是正常的。等到它停下来，出现类似 `added 300 packages` 的信息就算完成了。

> ⚠️ 如果出现红色 `ERR!` 错误，大概率是网络问题。可以试试：
> ```powershell
> npm install --registry=https://registry.npmmirror.com
> ```

---

## 第五步：启动服务（需要开两个窗口！）

ITEIPPT 需要**同时运行两个程序**，所以你要打开**两个 PowerShell 窗口**。

### 窗口 A：启动 API 代理（帮你和 AI 通话的中间人）

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT\src
npm run proxy:dev
```

如果看到类似以下输出，说明成功：
```
API proxy listening on http://127.0.0.1:8787
```

> ⚠️ **这个窗口不要关！不要关！不要关！** 关了 AI 就断了。把它最小化到任务栏就行。

### 窗口 B：启动前端网页

**新开一个 PowerShell 窗口**（别在窗口 A 里操作），输入：

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT\src
npm run dev
```

如果看到类似以下输出，说明成功：
```
  VITE v6.2.0  ready in 500 ms

  ➜  Local:   http://localhost:3000/
```

---

## 第六步：打开浏览器使用

1. 打开 **Chrome 浏览器**（推荐 Chrome，其他浏览器可能有兼容问题）
2. 在地址栏输入：

```
http://localhost:3000
```

3. 你应该能看到 ITEIPPT 的 6 步操作界面了！🎉

---

## 每次使用的流程（日常开机 SOP）

每次关机重开后，只需要重复第五步：

```
打开窗口 A → cd src → npm run proxy:dev → 最小化
打开窗口 B → cd src → npm run dev → 最小化
打开浏览器 → http://localhost:3000
```

用完了想关掉：在两个 PowerShell 窗口里分别按 `Ctrl + C` 就停了。

---

## 想部署到云上？（进阶，可选）

如果你想让其他人通过网址（不是 localhost）也能访问，需要部署到 Firebase。**这一节比较复杂，如果只在自己电脑用可以完全跳过。**

### 云部署 Step 1：安装 Firebase CLI

```powershell
npm install -g firebase-tools
```

### 云部署 Step 2：登录 Firebase

```powershell
firebase login
```

浏览器会弹出 Google 登录页面，授权后回来。

### 云部署 Step 3：创建 Firebase 项目

1. 打开 https://console.firebase.google.com/
2. 点 **添加项目** → 起名 `iteippt` → 关掉 Analytics → 创建
3. 在左侧菜单找到 **Hosting** → 点开始
4. 找到 **Storage** → 点开始 → 选"以生产模式启动"
5. 找到 **Functions** → 需要升级为 **Blaze 计划**

> 💡 Blaze 是按量付费，但有很大的免费额度。正常内部使用完全不花钱。建议设置预算提醒为 ¥0。

### 云部署 Step 4：初始化项目

```powershell
cd c:\Users\61973\Documents\cc-projects\ITEIPPT
firebase init
```

弹出选择菜单，用空格选中这三个，然后回车：
- ◉ Hosting
- ◉ Functions
- ◉ Storage

后续问答按以下填写：

| 它问你 | 你选 |
|--------|------|
| 使用已有项目还是新建？ | **Use an existing project** → 选 `iteippt` |
| Functions 语言？ | **TypeScript** |
| 用 ESLint？ | **No** |
| 安装依赖？ | **Yes** |
| Hosting 的 public 目录？ | **`src/dist`** ⚠️ 注意不是 `dist`！ |
| 配置为单页应用？ | **Yes** |
| 自动构建？ | **No** |
| Storage 规则文件？ | **storage.rules**（默认回车） |

### 云部署 Step 5：配置 API Key

```powershell
firebase functions:secrets:set GEMINI_API_KEY
```

终端会让你输入 Key 值，粘贴你的 Key 回车。

### 云部署 Step 6：构建并部署

```powershell
# 1. 构建前端
cd c:\Users\61973\Documents\cc-projects\ITEIPPT\src
npm run build

# 2. 构建云函数
cd ..\functions
npm install
npm run build

# 3. 回到项目根目录，一键部署
cd ..
firebase deploy
```

部署成功后终端会显示：
```
✔ Deploy complete!
Hosting URL: https://iteippt.web.app
```

把这个网址发给同事，他们就能用了。

> ⚠️ **当前云部署限制**：Firebase Functions 目前只实现了 `/api/plan`（第二步框架规划）。第三步的内容生成（`/api/generate-content`）还没迁移上去。**如果需要完整功能，目前请用本地双进程方式。**

---

## 让国内也能访问：Cloudflare 子域名映射（云部署后必做）

Firebase 部署完之后，你会得到一个 `https://iteippt.web.app` 的地址。**但这个地址在国内打不开**（Google 域名被墙了）。

解决方案：**用你的域名 + Cloudflare 做一层中间代理**。国内用户访问的是你的域名（比如 `ppt.yourdomain.com`），Cloudflare 在背后帮你转发到 Firebase。

```
国内用户浏览器
    │  访问 ppt.yourdomain.com（能打开✅）
    ▼
Cloudflare CDN（在中国有节点）
    │  橙色云朵 Proxy 模式
    │  ├── 网页文件 → Cloudflare 缓存加速
    │  └── /api/* 请求 → 转发给 Firebase Functions
    ▼
Firebase Hosting + Functions（藏在 Cloudflare 后面）
    │  GCP 内网直通
    ▼
Gemini API（不经过墙，直接调用）
```

### 映射 Step 1：在 Firebase 绑定你的域名

1. 打开 [Firebase Console](https://console.firebase.google.com/) → 选你的项目
2. 左侧菜单点 **Hosting**
3. 点 **添加自定义网域**
4. 输入你要用的子域名，比如 `ppt.yourdomain.com`
5. Firebase 会给你两条 DNS 记录要求你验证（一条 TXT 验证所有权，一条 A/CNAME 指向 Firebase）
6. **先别急着去域名商加记录**，把这两条记录抄下来，下一步要用

### 映射 Step 2：在 Cloudflare 配置 DNS

1. 登录 [Cloudflare 仪表盘](https://dash.cloudflare.com/)
2. 点你的域名进入管理页面
3. 左侧点 **DNS** → **记录**
4. 添加 Firebase 要求的 **TXT 记录**（用于验证域名所有权）：

| 类型 | 名称 | 内容 | 代理状态 |
|------|------|------|---------|
| TXT | `ppt` | Firebase 给你的验证字符串 | **仅 DNS**（灰色云朵） |

5. 添加 **指向 Firebase 的 CNAME 记录**：

| 类型 | 名称 | 目标 | 代理状态 |
|------|------|------|---------|
| CNAME | `ppt` | Firebase 给你的地址（类似 `iteippt.web.app`） | **已代理**（橙色云朵 ☁️） |

> ⚠️ **橙色云朵必须开！** 这是关键。橙色 = Cloudflare 代理模式 = 国内用户连的是 Cloudflare 而不是 Google = 能打开。如果是灰色云朵，用户还是直连 Google，国内照样打不开。

### 映射 Step 3：回 Firebase 完成验证

1. 回到 Firebase Console → Hosting → 自定义网域
2. 等 DNS 记录生效（通常几分钟，最多 24 小时）
3. Firebase 检测到 TXT 记录后，状态会变成 **"已连接"**
4. HTTPS 证书会自动签发（Firebase 和 Cloudflare 各管一层，不用你操心）

### 映射 Step 4：验证国内可达性

打开浏览器访问：

```
https://ppt.yourdomain.com
```

如果能看到 ITEIPPT 的 6 步界面，**恭喜，国内部署完成！** 🎉

把这个地址发给同事就行。`/api/*` 的请求也会自动走这个域名，不需要额外配置。

> 💡 **为什么 API 也能用？** 因为 `firebase.json` 里配了 rewrite 规则（`/api/**` → Functions），这个规则对自定义域名同样生效。用户请求 `ppt.yourdomain.com/api/plan` → Cloudflare → Firebase Hosting → rewrite → Firebase Functions，一路畅通。

### 映射常见问题

| 情况 | 原因 | 解决 |
|------|------|------|
| DNS 一直显示"等待验证" | TXT 记录还没生效 | 等 10 分钟，用 `nslookup -type=TXT ppt.yourdomain.com` 检查 |
| 能打开网页但 API 报错 | Cloudflare 的 SSL 模式不对 | Cloudflare → SSL/TLS → 加密模式改为 **完全（严格）** |
| 证书错误 / HTTPS 不安全 | 两层证书冲突 | Cloudflare SSL 模式用 **完全（严格）**，不要用"灵活" |
| 国内仍然打不开 | CNAME 没开橙色云朵 | Cloudflare DNS 记录里，把灰色云朵点成橙色 |

---

## 给系统加把锁：Cloudflare Access 邮箱验证码登录（云部署后建议做）

上面的 Cloudflare 映射完成后，**知道域名的人都能直接用你的系统**。如果你不想裸奔，可以加一层登录墙 —— 用户必须输入邮箱、收一封验证码邮件、填对验证码，才能进系统。

**不需要改任何代码**，全在 Cloudflare 后台点几下就行。

```
用户打开 ppt.yourdomain.com
    │
    ▼
Cloudflare Access 拦截 ──→ 弹出页面："请输入您的邮箱"
    │                              ↓
    │                       用户填邮箱，点发送
    │                              ↓
    │                       邮箱收到 6 位验证码
    │                              ↓
    │                       用户填验证码，点验证
    │
    ▼ ✅ 通过
正常使用 ITEIPPT（前端 + API 都放行）
```

### 加锁 Step 1：打开 Cloudflare Zero Trust 后台

1. 打开 https://one.dash.cloudflare.com/
2. 用你的 Cloudflare 账号登录
3. 如果是第一次用，它会让你选一个团队名称（随便填，比如 `iteiteam`），然后选 **Free 计划**（50 人以内免费）

### 加锁 Step 2：添加登录方式

1. 左侧菜单点 **Settings → Authentication**
2. 在 **Login methods** 里，找到 **One-time PIN** —— 确认它是 **已启用** 状态
3. 如果没有，点 **Add new → One-time PIN → Save**

> 💡 One-time PIN 就是"邮箱验证码登录"。用户输入邮箱 → 收到 6 位数字 → 输入数字 → 登录成功。不需要注册、不需要密码。

### 加锁 Step 3：创建应用并设置白名单

1. 左侧菜单点 **Access → Applications**
2. 点 **Add an application**
3. 选 **Self-hosted**
4. 填写基本信息：
   - **Application name**：`ITEIPPT`（随便填，自己认识就行）
   - **Session Duration**：`24 hours`（登录一次管 24 小时，过期再验一次）
   - **Application domain**：
     - Domain：`yourdomain.com`（你的主域名）
     - Subdomain：`ppt`（你之前配的子域名前缀）
5. 点 **Next**

### 加锁 Step 4：设置谁能登录（Policy）

1. **Policy name**：`允许的用户`（随便填）
2. **Action**：选 **Allow**
3. **Configure rules**，在 **Include** 下面选一种：

**方式 A：指定几个人的邮箱（最严格）**

| Selector | Value |
|----------|-------|
| Emails | `zhangsan@example.com` |
| Emails | `lisi@example.com` |
| Emails | `wangwu@example.com` |

**方式 B：允许某个公司域名下的所有人（方便管理）**

| Selector | Value |
|----------|-------|
| Emails ending in | `@yourcompany.com` |

4. 点 **Next** → **Next** → **Add application**

### 加锁 Step 5：验证效果

1. 打开一个**无痕浏览器窗口**（Ctrl + Shift + N）
2. 访问 `https://ppt.yourdomain.com`
3. 应该先看到一个 Cloudflare 的登录页面，要求输入邮箱
4. 输入白名单里的邮箱 → 收到验证码 → 输入验证码
5. 验证通过后才能看到 ITEIPPT 的 6 步界面

> ⚠️ 如果用的邮箱不在白名单里，会直接被拒绝，看不到任何系统内容。

### 日常管理：加人 / 踢人

| 你想做什么 | 去哪里操作 |
|-----------|-----------|
| 加一个新用户 | Zero Trust → Access → Applications → 点 ITEIPPT → Policies → 编辑 → Include 里加一行邮箱 |
| 踢掉一个人 | 同上，删掉那行邮箱 |
| 看谁登录过 | Zero Trust → Logs → Access Requests（有时间、邮箱、IP 地址） |
| 临时关掉登录墙 | Access → Applications → 点 ITEIPPT → 右上角关掉开关 |

---

## 出了问题怎么办？

| 你碰到的情况 | 原因 | 怎么解决 |
|:---|:---|:---|
| `npm install` 报一堆红色 ERR | 网络问题，npm 默认源被墙 | 加镜像源重试：`npm install --registry=https://registry.npmmirror.com` |
| `npm run proxy:dev` 报 `Cannot find module` | 依赖没装好 | 重新跑 `npm install` |
| 浏览器打开 localhost:3000 白屏 | 窗口 B 没启动或报错了 | 检查窗口 B 是否正常运行 |
| 点了 AI 生成按钮没反应 | 窗口 A 的代理没启动 | 看窗口 A 是否显示 `listening on 8787` |
| 弹窗 `missing_api_key` | `.env` 文件没配或 Key 写错了 | 打开 `src/.env` 检查第一行 |
| AI 生成中途报错 | 网络波动或 Gemini API 临时故障 | 等一分钟，重新点生成按钮 |
| 下载的 PPT 打不开 | Office 版本太旧 | 用 WPS 或 Office 2016+ 打开 |

---

## 命令速查卡（打印贴在显示器旁边）

```
╔═══════════════════════════════════════════════════╗
║         ITEIPPT 每日启动步骤（共 3 步）           ║
╠═══════════════════════════════════════════════════╣
║                                                   ║
║  ① 打开 PowerShell，输入：                       ║
║     cd c:\Users\61973\Documents\               ║
║        cc-projects\ITEIPPT\src                    ║
║     npm run proxy:dev                             ║
║     （看到 listening 就最小化）                    ║
║                                                   ║
║  ② 再开一个 PowerShell，输入：                   ║
║     cd c:\Users\61973\Documents\               ║
║        cc-projects\ITEIPPT\src                    ║
║     npm run dev                                   ║
║     （看到 ready 就最小化）                       ║
║                                                   ║
║  ③ 打开 Chrome，地址栏输入：                     ║
║     http://localhost:3000                         ║
║                                                   ║
║  关闭方法：两个窗口各按一次 Ctrl+C               ║
╚═══════════════════════════════════════════════════╝
```
