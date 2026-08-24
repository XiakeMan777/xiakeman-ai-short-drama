# 部署说明

## 1. 本地开发

```powershell
npm ci
npm ci --prefix bff
Copy-Item .env.example .env
npm run dev:bff
```

另开一个终端：

```powershell
npm run dev
```

`bff/package.json` 会在根目录 `.env` 存在时自动加载它。Vite 也会按自身规则读取根目录 `.env`。

Windows 可运行 `start.bat`；脚本检查 Node、安装缺失依赖、避免重复占用 8022/8030 端口并启动两个服务。

## 2. 生产构建

```powershell
npm ci
npm ci --prefix bff
npm run encoding:check
npm run build
npm start --prefix bff
```

`dist/` 是前端静态文件。使用 Nginx、Caddy 或其他静态服务器托管时：

- 未命中静态文件的页面请求回退到 `index.html`。
- `/api/` 反向代理到 BFF。
- 上传和读取超时要覆盖长视频、渲染和模型轮询场景。
- 不要缓存 `index.html`；带 hash 的 JS/CSS 可长期缓存。

## 3. Docker

```powershell
npm run docker:prepare
docker build -t xiakeman-community .
docker run --rm `
  --env-file .env `
  -p 8080:80 `
  -v xiakeman-data:/data `
  xiakeman-community
```

镜像内 Nginx 监听 80，BFF 监听 8030。`start.sh` 将文件存储默认映射到 `/data`：

- `/data/xiakeman-auth-store`
- `/data/xiakeman-cloud-store`
- `/data/xiakeman-object-store`

不挂载持久卷会在容器删除时丢失 BFF 兼容数据、对象和服务端配置；浏览器本地项目不在容器卷中。

## 4. 小范围共享部署建议

100～200 个使用者不等于 100～200 个同时生成任务。首次部署先使用 `.env.example` 中较保守的 worker 并发，再根据上游限流、CPU、内存、网络和任务队列等待时间调整。

推荐边界：

- 单机体验：文件存储 + 本地对象目录 + 单 BFF 实例。
- 多实例或需要故障恢复：Postgres + 外部对象存储；不要让多个实例同时写同一套普通 JSON 文件。
- 渲染任务独占 CPU/磁盘较多，`BACKGROUND_WORKER_RENDER_CONCURRENCY` 从 1 开始。
- 视频、图片上游通常比本机更早触发限流，应按实际账号配额调整对应并发。
- 设置 `BACKGROUND_WORKER_TOKEN`，不要把 worker 控制接口裸露给公网。

## 5. 网络与兼容接口安全

公网或局域网共享部署至少修改：

```dotenv
NODE_ENV=production
CORS_ORIGIN=https://your-domain.example
AUTH_COOKIE_SECURE=true
AUTH_SECRET=<long-random-secret>
APP_SETTINGS_SECRET=<long-random-secret>
ADMIN_EMAILS=owner@example.com
AUTH_ALLOW_REGISTRATION=false
```

社区前台没有注册和登录入口。BFF 仍挂载认证、云项目、管理和 Agent 兼容接口；如果不做二次接入，建议在反向代理层直接限制这些路径，并保持 `AUTH_ALLOW_REGISTRATION=false`。

所有上游地址白名单都应填写真实需要的域名。不要把 `localhost`、私网网段或宽泛父域加入生产白名单，除非它们确实是受控的内部服务。

## 6. Postgres

设置 `DATABASE_URL`，并把实际使用的驱动切到 `postgres`：

```dotenv
DATABASE_URL=postgres://user:password@db:5432/xiakeman
AUTH_STORE_DRIVER=postgres
CLOUD_STORE_DRIVER=postgres
BACKGROUND_JOB_STORE_DRIVER=postgres
APP_SETTINGS_DRIVER=postgres
```

BFF 启动时会执行 `bff/migrations` 中的结构初始化。上线前仍应单独备份数据库，并在测试库验证升级。

## 7. 对象存储

默认 `OBJECT_STORAGE_DRIVER=local`。切换腾讯 COS/S3 兼容存储时填写 bucket、region、endpoint、prefix 和凭据。凭据只通过环境变量或管理员设置保存，不要写入 Git。

社区前台没有管理员后台。需要对象存储时通过环境变量配置，或自行接入保留的管理 API；服务端配置使用稳定加密密钥加密，密钥丢失后无法恢复已保存的 SecretKey。

## 8. FFmpeg 与临时空间

`FFMPEG_PATH` 默认是 `ffmpeg`，要求可执行文件在 PATH 中。渲染还会调用 ffprobe。确保：

- `RENDER_WORK_DIR` 所在磁盘有足够空间。
- 定时清理过期任务，但不要在任务执行中删除工作目录。
- 上传上限、反向代理上限和 `RENDER_MAX_UPLOAD_BYTES` 一致。

Docker 镜像已安装 FFmpeg；Electron 打包需要另行提供 `bin` 目录或系统 PATH。

## 9. 发布后检查

```powershell
Invoke-RestMethod http://localhost:8030/api/health
```

然后使用新的浏览器配置执行：

1. 访问首页，确认没有登录入口和 `/api/auth/*` 请求。
2. 打开“交流群”，确认二维码正常显示。
3. 保存 API 设置并刷新，确认当前浏览器可以恢复本地配置。
4. 创建一个小项目，完成一次低成本 LLM 请求。
5. 分别验证图片、视频和本地任务状态。
6. 有 FFmpeg 时完成一个短片渲染并下载。
