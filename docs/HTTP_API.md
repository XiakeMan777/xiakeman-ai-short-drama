# BFF HTTP API

入口为 `bff/server.js`，默认基地址 `http://localhost:8030`。本页只记录当前路由和访问边界；请求/响应字段应以对应模块实现为准。

社区前台不提供虾客漫账号登录，也不调用认证、账号云同步、Agent Key 或管理后台接口。下面对应路由仍由 BFF 挂载，仅用于记录现存自托管兼容协议，不能据此认为默认 UI 已开放这些功能。

## 访问方式

- 浏览器会话：HttpOnly Cookie，由 `/api/auth/login` 或 `/api/auth/register` 创建。
- Agent Key：协议仍保留，但社区前台没有创建或管理入口。
- Worker：配置 `BACKGROUND_WORKER_TOKEN` 后，通过 Bearer token 访问 worker 路由；管理员会话也可操作。
- 管理员：`role=admin` 的浏览器会话或等价认证上下文。

## 基础、模型和媒体

| 方法 | 路径 | 访问边界 | 作用 |
| --- | --- | --- | --- |
| GET | `/api/health` | 公共 | BFF 健康状态 |
| POST | `/api/chat/completions` | 公共 + 限流 | 服务端模板注入与 LLM 代理 |
| GET | `/api/proxy/image?url=` | 公共 + 限流/域名检查 | 图片跨域代理 |
| GET | `/api/proxy/video?url=` | 公共 + 限流/域名检查 | 视频跨域代理 |
| POST | `/api/media/seedance-direct-upload-tickets` | 公共 + 限流 | 生成 Seedance 直传票据 |
| GET | `/api/media/voice-corpus` | 公共 + 限流 | 列出本地声线语料 |
| GET | `/api/media/voice-corpus/audio?file=` | 公共 + 限流 | 读取声线语料音频 |
| POST | `/api/media/audio-to-black-video` | 公共 + 限流 | 将音频封装为黑色视频，需要 FFmpeg |

这些公共路由适合本地开发。公网部署应在反向代理层增加认证、速率、出站域名和上传限制。

## 认证 `/api/auth`

| 方法 | 子路径 | 访问边界 |
| --- | --- | --- |
| GET | `/me` | 公共；未登录返回 `{ user: null }` |
| POST | `/register` | 公共；受 `AUTH_ALLOW_REGISTRATION` 控制 |
| POST | `/login` | 公共 |
| POST | `/logout` | 公共 |
| GET / POST | `/agent-keys` | 登录用户 |
| DELETE | `/agent-keys/:keyId` | 登录用户 |
| GET | `/model-config` | 登录用户 |
| PUT | `/model-config/llm` | 登录用户 |
| PUT | `/model-config/image` | 登录用户 |
| PUT | `/model-config/video` | 登录用户 |

## 管理 `/api/admin`

整个前缀要求管理员：

- `GET /summary`
- `GET /background-jobs`
- `GET /background-worker-config`
- `PUT /background-worker-config`
- `GET /users`
- `PATCH /users/:userId`
- `GET /users/:userId/projects`
- `DELETE /users/:userId/projects/:projectId`
- `GET /storage-config`
- `PUT /storage-config`
- `POST /storage-config/test`

## 云项目 `/api/cloud`

整个前缀要求登录：

- `GET /health`
- `GET /projects`
- `GET /projects/:projectId`
- `PUT /projects/:projectId`
- `DELETE /projects/:projectId`
- `GET /projects/:projectId/manifest`
- `GET /projects/:projectId/structure`
- `PUT /projects/:projectId/structure`
- `POST /projects/:projectId/finalize`
- `PUT /projects/:projectId/blobs`
- `GET /projects/:projectId/blobs/raw`
- `POST /projects/:projectId/blobs/direct-upload`
- `POST /projects/:projectId/blobs/direct-complete`
- `POST /projects/:projectId/blobs/download-urls`

项目和 blob 操作按当前用户隔离。大文件上限由 cloud/object-storage 环境变量共同控制。

## 后台任务 `/api/jobs`

普通任务要求登录并按用户隔离：

- `GET /health`
- `GET /`
- `POST /`
- `GET /:id`
- `PATCH /:id`
- `POST /:id/cancel`
- `POST /:id/retry`
- `GET /:id/events`
- `POST /:id/events`

Worker 路由：

- `POST /worker/claim`
- `POST /worker/:id/heartbeat`
- `POST /worker/:id/finish`

设置 `BACKGROUND_WORKER_TOKEN` 后，worker 路由需要对应 Bearer token；管理员也可访问。

## 渲染 `/api/render`

- `GET /health`
- `POST /jobs`
- `GET /jobs/:id`
- `GET /jobs/:id/download`
- `DELETE /jobs/:id`

当前路由没有挂载账号认证中间件。共享部署必须在反向代理层限制访问，否则外部用户可能消耗 CPU、磁盘和上传带宽。

## Agent `/api/agent`

该前缀要求通过认证中间件，提供以下能力：

- 健康与配置：`GET /health`、`GET /config`
- 管理员模型配置：`PUT /config/llm|image|video`
- 用户模型配置：`PUT /config/user/llm|image|video`
- 存储配置：`PUT /config/storage`
- 项目：`GET/POST /projects`、`GET/PUT /projects/:projectId`
- 脚本：`PUT /projects/:projectId/script`
- 项目任务：`POST /projects/:projectId/jobs`
- 任务：`GET /jobs`、`GET /jobs/:jobId`、`GET /jobs/:jobId/events`
- 任务控制：`POST /jobs/:jobId/retry|cancel`
- 审计：`POST /projects/:projectId/audit`
- 返修：`GET/POST /projects/:projectId/refinements`
- 返修决策：`POST /projects/:projectId/refinements/:refinementId/apply|reject`

部分配置路由在模块内部再次检查管理员角色。

## 小云雀 Agent `/api/xyq-agent`

- `POST /submit-run`
- `POST /get-thread`
- `POST /upload-file`

路由受全局限流和 `XYQ_AGENT_BASE_ALLOWLIST` 约束，但没有挂载用户会话认证。公网部署应由反向代理限制来源。
