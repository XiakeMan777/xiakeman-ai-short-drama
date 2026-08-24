# 部署指南

只在自己的电脑上使用时，推荐直接运行 `start.bat`。Docker 和公网部署适合熟悉服务器、反向代理和数据备份的使用者。

## Windows 本地使用

先安装 Node.js 20.19 或更高版本，然后双击仓库根目录的 `start.bat`。

脚本会：

1. 检查 Node.js。
2. 安装缺少的前端和 BFF 依赖。
3. 启动 BFF 服务。
4. 启动网页服务。

浏览器打开 `http://localhost:8022`。BFF 健康检查地址是 `http://localhost:8030/api/health`。

如果 8022 或 8030 端口已被其他程序占用，先关闭对应程序，或在 `.env` 中调整端口后再启动。

## 手动启动

```powershell
npm ci
npm ci --prefix bff
Copy-Item .env.example .env
npm run dev:bff
```

再开一个终端：

```powershell
npm run dev
```

根目录 `.env` 同时用于本地前端代理和 BFF。不要把填写了真实密钥的 `.env` 提交到 GitHub。

## Docker

先准备前端构建和 BFF 文件：

```powershell
npm ci
npm ci --prefix bff
npm run docker:prepare
docker build -t xiakeman-community .
```

启动：

```powershell
docker run --rm `
  --env-file .env `
  -p 8080:80 `
  -v xiakeman-data:/data `
  xiakeman-community
```

访问 `http://localhost:8080`。请保留 `xiakeman-data` 数据卷；删除容器时如果没有挂载持久卷，BFF 的本地数据和对象文件会一起丢失。浏览器中的本地项目仍保存在访问者自己的浏览器，不在这个数据卷里。

## 放到局域网或公网之前

默认开发配置不能直接当成公共服务。至少完成以下设置：

- 使用 HTTPS。
- 把 `CORS_ORIGIN` 限制为实际网站地址。
- 使用稳定、足够长的 `AUTH_SECRET` 和 `APP_SETTINGS_SECRET`。
- 设置 `AUTH_ALLOW_REGISTRATION=false`。
- 为对话、图片、语音、音乐和 Agent 配置上游域名白名单。
- 在反向代理中增加速率、上传大小和请求超时限制。
- 限制前台不用的 `/api/auth`、`/api/admin`、`/api/cloud`、`/api/jobs` 和 `/api/agent`。
- 不要把 worker 控制接口、渲染接口和媒体代理无保护地暴露到公网。

示例：

```dotenv
NODE_ENV=production
CORS_ORIGIN=https://your-domain.example
AUTH_COOKIE_SECURE=true
AUTH_SECRET=<long-random-secret>
APP_SETTINGS_SECRET=<long-random-secret>
AUTH_ALLOW_REGISTRATION=false
BACKGROUND_WORKER_TOKEN=<long-random-token>
```

如果没有二次开发账号体系，关闭注册并限制兼容接口即可；前台本身不需要用户登录。

## 100～200 人小范围使用

人数不等于同时生成任务数。视频和图片上游通常最先遇到限流，渲染则更容易占满本机 CPU、内存和磁盘。

建议从保守配置开始：

- 先使用单个 BFF 实例。
- 文件存储适合单实例；需要多实例时改用 Postgres 和外部对象存储。
- 渲染并发从 1 开始。
- 视频并发从 1～2 开始，再根据上游额度和平均等待时间调整。
- 图片与对话并发不要超过上游账号允许的速率。
- 监控任务队列、临时目录、磁盘剩余空间和失败率。

不要让多个 BFF 实例同时写同一套普通 JSON 文件。

## Postgres 和对象存储

需要更可靠的服务端任务、账号兼容数据或多实例部署时，可以配置 Postgres：

```dotenv
DATABASE_URL=postgres://user:password@db:5432/xiakeman
AUTH_STORE_DRIVER=postgres
CLOUD_STORE_DRIVER=postgres
BACKGROUND_JOB_STORE_DRIVER=postgres
APP_SETTINGS_DRIVER=postgres
```

BFF 启动时会执行 `bff/migrations` 中的初始化。请先在测试数据库验证，并定期备份数据库。

大媒体默认保存在本地目录，也可以切换到腾讯 COS 或 S3 兼容对象存储。Bucket、Region、Endpoint 和密钥只放在安全的环境变量或服务端配置中。

## FFmpeg 和磁盘空间

`FFMPEG_PATH` 默认使用系统 PATH 中的 `ffmpeg`，同时还需要 ffprobe。请确保渲染工作目录有足够空间，并让反向代理上传上限与 `RENDER_MAX_UPLOAD_BYTES` 保持一致。

## 上线后检查

1. 打开 `/api/health`，确认 BFF 正常。
2. 用新的浏览器打开首页，确认 Logo、交流群和 API 设置正常。
3. 保存 API 设置并刷新页面，确认配置能恢复。
4. 创建一个小项目，完成一次低成本对话请求。
5. 分别验证需要使用的图片和视频通道。
6. 安装 FFmpeg 后完成一个短视频合成与下载。
7. 检查日志中没有 Authorization、Cookie 或完整 API Key。

更完整的接口边界见 [BFF HTTP API](HTTP_API.md)，安全注意事项见 [安全说明](../SECURITY.md)。
