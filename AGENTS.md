# Sub2API 项目上下文

> 本文件用于让后续代理快速了解服务器、服务端和手机端之间的关系。动态信息最后核对时间为 2026-07-29（Asia/Shanghai），使用前必须重新确认。

## 基本要求

- 永远使用中文回复。
- 开始修改前检查当前仓库和关联仓库的 `git status --short --branch`，保留所有用户未提交修改。
- 手机端、服务端和生产环境是三个独立状态。不得把“本地代码已实现”“APK 已构建”表述成“生产服务器已部署”。
- 除“云服务器信息入口”中明确授权的云悠网页登录凭据外，密码、Admin Key、API Key、JWT、数据库口令、SSH 密码和私钥不得写入本文件或提交到仓库。该例外仅限本地 `AGENTS.md`，不得复制到其他代码、文档或回复中。

## 云服务器信息入口

- 云服务商：云悠 YUNYOO。
- 实例详情页：`https://yunyoo.cc/servicedetail?id=123687`。
- SSH 端口会变化，**不要在代码、文档或记忆中固定 SSH 端口**。
- 每次需要服务器 IP、SSH 端口、实例状态、到期时间、操作系统或重装信息时，先在浏览器打开上述实例详情页读取当前值，再执行连接或运维操作。
- 云悠网页登录凭据（用户明确授权；仅限此本地未跟踪文件使用，禁止 Git 提交或在回复中展示）：
  - 账号：153687017@qq.com
  - 密码：caling3344
- 实例详情页需要云悠账号登录。若跳转到 `https://yunyoo.cc/login`，优先使用用户 Google Chrome 配置中已经保存的自动填充凭据完成登录，然后重新打开实例详情页；普通的自动填充登录不需要再次请求用户确认。
- 用户已明确授权代理在 `yunyoo.cc` 使用上述本地凭据或 Chrome 已保存的登录信息。不得展示、复制或写入其他位置；只有自动填充和直接登录均不可用、Chrome 控制连接不可用、登录失败，或页面要求验证码、短信/邮箱验证码、Passkey 等额外验证时，才向用户说明并请求必要协助。
- 生产 SSH 用户为 `root`；主机和端口以实例详情页当次显示为准。

## 生产环境

- 对外域名：`https://cacr.site`。
- 健康检查：`https://cacr.site/health`。
- 管理后台：`https://cacr.site/admin`。
- 账号管理：`https://cacr.site/admin/accounts`。
- 系统设置：`https://cacr.site/admin/settings`。
- 用户仪表盘：`https://cacr.site/dashboard`。
- API 基地址：`https://cacr.site`；管理接口前缀为 `/api/v1/admin`，网关接口前缀为 `/v1`。
- 2026-07-29 的公开只读核验结果：`cacr.site` 解析到 `70.39.197.192`，`GET /health` 返回 `{"status":"ok"}`，管理后台返回 HTTP 200。IP 仍应以云悠实例详情页和实时 DNS 为准。
- 服务器部署目录：`/opt/sub2api`。
- 部署组成：Nginx 反向代理、Sub2API Docker 容器、PostgreSQL 和 Redis。
- 最近一次完整部署采用蓝绿切换：新实例曾在宿主机回环地址 `18084`，旧实例曾在 `18083`；旧实例已在连接排空后移除。内部端口同样属于动态部署信息，操作前必须检查当前 Nginx 和 Docker 状态。
- 容器内应用端口通常为 `8080`，生产容器重启策略最近核验为 `unless-stopped`。
- 最近一次完整验证的生产版本：私有构建 `v0.1.168`。
- 最近一次生产镜像：`sub2api-private:0.1.168-9f5a1a051-upstream-cost-today-20260729`。
- 最近一次生产备份：`/opt/sub2api/backups/pre-v0.1.168-20260729T043158Z`。
- 生产配置、Compose 文件和 `.env` 位于 `/opt/sub2api`，其中包含敏感值；只可在已授权的服务器会话中读取，不得复制进仓库或回复。
- Nginx 的 `http` 块需要保留 `underscores_in_headers on;`，否则 Codex CLI 使用的 `session_id` 等带下划线请求头可能被丢弃。

## 同机 CCH 容器

> CCH 信息最后核对时间：2026-09-03（Asia/Shanghai）。目录、监听端口、Nginx 状态和 Provider 数据均可能变化，操作前必须现场回读。

- CCH（Claude Code Hub）部署目录：`/opt/claude-code-hub`；Compose 项目名：`cch`。
- 对外管理/API 入口：`https://cch.cacr.site`；健康检查：`/api/health`（组件状态）和 `/api/v1/health`（API 状态）。
- Nginx 配置：`/etc/nginx/sites-available/cch`，当前反向代理到宿主机回环地址上的 CCH 应用端口；端口以 `docker compose ps` 和 Nginx 配置现场值为准，不能从历史记录猜测。
- 当前部署由 CCH 应用、PostgreSQL 和 Redis 三个容器组成；数据库和 Redis 不对公网暴露。当前镜像版本为 `0.9.5`，镜像使用仓库中的固定 digest，升级前需重新核对发布版本和备份。
- CCH 与 Sub2API 完全隔离：CCH 的 Compose、数据库、Redis、Nginx 站点和备份只允许操作 `/opt/claude-code-hub` 对应资源；未经单独授权不得重启、重载、改写或清理 `/opt/sub2api`、`cacr.site` 或其数据库。
- CCH 管理 API 使用 Admin Key/Bearer 或登录 Cookie；凭据只能在授权的服务器会话或本机安全存储中使用，禁止写入仓库、脚本、日志、截图和回复。对 CCH 做写操作前，先在 `/opt/claude-code-hub/backups` 创建并验证 PostgreSQL 备份。
- Provider 协议语义：`openai-compatible` 对应 OpenAI `/v1/chat/completions`，`codex` 对应 `/v1/responses`，`claude` 对应 Anthropic Messages。一个上游 Key 同时支持两种 OpenAI 入口时，拆成 Chat 与 Responses 两条记录是必要配置，不得仅按显示名称、供应商网站或 Vendor 名称去重；协议类型必须和上游能力逐条核对。
- CCH 的 `default` 是无分组回退语义，不等同于可删除的业务分组；删除 Provider 或分组前必须先确认数据库对象、引用关系和运行时语义。
- 截至上述核对时间，CCH 活动 Provider 的流式首字节超时为 `15000 ms`（15 秒）；这是可变运行配置，修改前必须重新读取当前 Provider 清单并保留备份。

## 生产构建与运行时边界

- 生产服务器不得执行 `bun install`、`npm install`、`pnpm install`、`docker build`、`docker buildx build`、Next/Vite/Go 源码编译或任何依赖下载。此规则适用于 Sub2API、CCH 和 CaCrFeedFormula 的每一次部署，不能因构建机不可用而退回到服务器构建。
- 镜像必须先在本机或 CI 构建为服务器可运行的 `linux/amd64` 制品；Apple Silicon 本机构建时使用 Buildx 指定 `--platform linux/amd64`，并在传输前核验镜像架构。生产服务器只允许拉取或导入已构建镜像、执行数据库迁移、启动 Green、健康检查、平滑切流和连接排空。
- 生产机只保留 `sub2api`、`cch`、`cacrfeedformula` 三个正式服务栈，以及它们不可拆分的运行时依赖（Nginx、对应 PostgreSQL、Redis 和持久化数据卷）。不得保留构建器容器、构建缓存、源码暂存目录、已停止的临时容器、过期镜像、传输镜像包或无引用卷。
- 部署结束后，在确认新实例健康、Nginx 已切流、旧实例连接排空且回滚保留期已满足后，逐项删除本次已验证的临时构建/暂存/传输资源。禁止使用未审计的广泛清理命令；清理前必须确认目标不属于三个正式服务栈或其持久化数据。
- 若生产机出现资源压力或健康检查失败，先停止隔离的临时资源并验证正式栈状态。不得为恢复构建或清理缓存而重启正式服务；主机重启、强制关机或救援模式必须获得用户当次明确授权。

## 生产功能状态

- `POST /api/v1/admin/accounts/upstream-costs/today` 已随私有 `v0.1.168` 部署并完成真实数据验证。
- 今日上游成本按 `Asia/Shanghai` 自然日统计，使用请求发生时保存的上游倍率快照；没有快照的历史请求不能套用当前倍率。
- `/api/v1/admin/accounts/upstream-costs/24h` 是兼容别名，手机端当前使用 `/today`。
- 上游倍率探测覆盖已配置的 OpenAI、Claude/Anthropic 和 Grok API Key 账号，但并非所有第三方上游都支持 Sub2API 专用倍率接口。
- `403 Insufficient account balance` 属于具体上游账号健康或余额问题，不代表 Sub2API 部署失败。
- 统一异常恢复接口为 `POST /api/v1/admin/accounts/{id}/recover-state`。本地服务端和手机端已有对应代码；生产是否包含最新恢复行为，必须通过已登录管理后台或带 Admin Key 的接口现场验证后再下结论。
- 最近一次已回读的调度快照：`TopK=1`、优先级权重 `100`、上游成本/倍率权重 `10`、负载权重 `1`、队列权重 `0.7`、错误率权重 `3`、TTFT 权重 `0.5`。这是历史快照，修改前必须从 `https://cacr.site/admin/settings` 重新读取。
- 最近一次已回读的流式超时策略：启用、首次命中即临时不可调度、持续 5 分钟、统计窗口 10 分钟。修改前同样必须重新读取。

## 服务端代码仓库

- 本地路径：`/Volumes/software/cursor/sub2api-server`。
- Git 远端：`https://github.com/Wei-Shaw/sub2api.git`。
- 当前工作分支快照：`codex/cross-platform-upstream-billing`。
- 当前服务端工作树存在未提交的账号测试恢复和管理后台 UI 修改，必须保留，不得回退。
- 当前私有提交链包含：上游倍率探测、Claude/Grok 探测、24 小时/今日上游成本估算和私有镜像覆盖定义。
- 后端：Go + Gin + Ent，`backend/go.mod` 是依赖来源。
- 前端：Vue 3 + Vite + Pinia + TypeScript，位于 `frontend/`。
- 数据层：PostgreSQL 15+ 和 Redis 7+。
- `backend/cmd/server/VERSION` 的本地值不一定等于生产私有镜像版本；生产版本应通过 `GET /api/v1/admin/system/version` 或容器镜像现场确认。
- 服务端管理接口需要管理员认证。手机端使用 `x-api-key` 请求头；没有 Admin Key 时，版本管理接口返回 401 属于正常行为。

## 手机端代码仓库

- 本地路径：`/Volumes/software/cursor/sub2api-mobile`。
- Git 远端：`https://github.com/ckken/sub2api-mobile.git`。
- 当前工作分支快照：`codex/upstream-billing-monitoring`。
- 用途：Sub2API 的移动运维与管理客户端，可管理服务器连接、用户、API Key、上游账号、分组、监控和部分服务端设置。
- 技术栈：Expo SDK 54、React Native 0.81、React 19、Expo Router、TanStack Query、Valtio、Uniwind、Zod。
- 路由页面位于 `app/`，主要页面实现位于 `src/screens/`，管理 API 位于 `src/services/admin.ts`，接口类型位于 `src/types/admin.ts`，服务器连接配置位于 `src/store/admin-config.ts`。
- 手机端不硬编码生产服务器。用户在登录页或设置页输入 Base URL 和 Admin Key；生产 Base URL 通常填写 `https://cacr.site`。
- 原生端使用 Expo SecureStore 保存服务器连接与 Admin Key，并支持多服务器切换；Web 端不会持久化 Admin Key。
- Web 本地代理位于 `server/index.js`，默认监听 `http://localhost:8787`，通过 `SUB2API_BASE_URL`、`SUB2API_ADMIN_API_KEY` 和 `ALLOW_ORIGIN` 环境变量配置。

## 手机端应用标识与发布

- 每次用户要求“重新构建”或“重新打包”Android 安装包时，都必须先使用一个高于当前值的新版本号；用户未指定版本时，默认将补丁版本加 1，并将 Android `versionCode` 加 1。不得用原版本号覆盖旧 APK。
- 新版本必须同步到 `app.json` 的 `expo.version` 和 `expo.android.versionCode`、`package.json`、`package-lock.json`；若本地生成目录 `android/` 已存在，还要同步 `android/app/build.gradle` 的 `versionName` 和 `versionCode`。
- 构建成功后必须将 APK 复制到项目根目录，命名为 `sub2api-mobile-v<version>-android-release.apk`。除非用户明确要求，不删除或覆盖根目录中的历史版本安装包。
- 交付前核验 APK 中的实际包名、`versionName`、`versionCode`、签名、ZIP 完整性和 SHA-256，并在回复中给出根目录绝对路径。
- Expo owner：`ckken`。
- Expo slug/name：`sub2api-mobile`。
- EAS Project ID：`acaedd05-5a2a-4843-a648-e025c08ce7b3`。
- Android package：`com.ppx.sub2apimobile`。
- iOS bundle identifier：`com.ppx.sub2apimobile`。
- URL scheme：`sub2apimobile`。
- Expo Updates URL：`https://u.expo.dev/acaedd05-5a2a-4843-a648-e025c08ce7b3`。
- `runtimeVersion` 使用 `appVersion` 策略；修改应用版本后，旧原生壳不能自动加载不匹配 runtime 的 OTA 更新。
- EAS profiles：`development` 为 dev client，`preview` 为内部预览并绑定 `preview` channel，`production` 自动递增并绑定 `production` channel。
- 2026-07-29 当前本地版本：`1.0.11`，Android `versionCode=12`。
- 当前最新 APK：`/Volumes/software/cursor/sub2api-mobile/sub2api-mobile-v1.0.11-android-release.apk`。
- 当前最新 APK SHA-256：`946f8b9609088d2066aa448eb915fb320ab87321211908cd462fcc47597d37c1`。
- 当前本地 Release APK 使用 Android Debug 证书做 v2 签名，可用于安装测试，不是应用商店生产签名。
- `/android` 和 `/ios` 被 Git 忽略，是 Expo 生成目录。应用版本来源为 `app.json`、`package.json` 和 `package-lock.json`；本地 `android/` 已存在时还需同步 `android/app/build.gradle`。
- 已验证的本地 Android 工具链：JDK 17、Gradle 8.14.3、Android API 36、NDK `27.1.12297006`、CMake 3.22.1。

## 手机端当前功能

- 首屏监控：服务器连接状态、账号总数、可调度数、正在服务数、当前并发、今日请求/Token/费用、上游成本覆盖情况和待处理异常账号。
- 账号页：状态筛选、分组查看、分组完整名称、服务商与账号信息、当前并发/并发上限、调度状态、上游倍率快照、今日上游成本、测试和手动恢复。
- 设置页：多服务器添加/切换/删除，连接验证，注册、邮箱验证、密码重置、渠道监控和默认并发数等服务端设置。
- 用户页：用户详情、状态控制、余额调整、API Key、用量和账号关系。
- 账号测试成功不等于异常状态已恢复；手机端会单独调用恢复接口并刷新账号、监控和成本 Query。

## 运维与验证边界

- 需要服务器连接信息时：先打开云悠实例详情页，不使用历史 SSH 端口。
- 需要生产业务配置时：先打开 `https://cacr.site/admin/settings` 或对应管理页读取当前值。
- 需要确认生产版本时：使用管理员版本接口、容器镜像和内部健康检查，不从本地 `VERSION` 猜测。
- 生产部署前必须先检查当前容器、Nginx 上游、数据库迁移和备份路径；部署后要做内部健康、公开健康、管理 API、真实 UI、连接排空和最终容器状态验证。
- 未经用户明确授权，不执行服务器部署、生产设置修改、EAS 发布、OTA 更新、Git 推送或付款操作。
