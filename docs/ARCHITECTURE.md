# 架构说明

本文以当前源码为准，入口时间点为 2026-07-02 社区快照，整理时间为 2026-08-23。

## 入口与运行形态

| 形态 | 入口 | 作用 |
| --- | --- | --- |
| Web 前端 | `src/main.tsx` → `src/App.tsx` | React 应用、工作流、独立工作台与本地状态 |
| BFF | `bff/server.js` | 认证、配置同步、模板注入、后台任务、云项目、对象存储、媒体代理和渲染 |
| Electron | `desktop/main.cjs` | 启动本地 BFF、静态站点和隔离的 BrowserWindow |
| Docker | `Dockerfile` → `start.sh` | 同一容器内启动 BFF 与 Nginx |
| 开发代理 | `vite.config.ts` | 把 `/api/*` 转发到 BFF 或显式配置的本地视频服务 |

前端不是路由框架应用。`App.tsx` 用 `ActiveView` 在以下界面间切换：`home`、`series`、`chapter`、`canvas-workbench`、`image-workbench`、`video-workbench`、`task-center`。

## 主业务流

章节状态决定主工作区加载哪个懒加载模块：

| 章节状态 | 实际模块 | 功能 |
| --- | --- | --- |
| `idle` / `scripting` / `adapting` | `components/step1/ScriptInput.tsx` | 剧本输入、小说改编、脚本整理 |
| `analyzing` | `components/step2/AnalysisResult.tsx` | 场景、角色、道具、分镜结构化确认 |
| `assets` | `components/step3/AssetManager*.tsx` | 参考图生成、上传、绑定和资产管理 |
| `generating` | `components/step4/PromptGenerator.tsx` | 视频提示词或完整故事板生成 |
| `videos` | `components/step5/VideoGenerator.tsx` | 视频提交、轮询、批处理和失败恢复 |
| `compositing` / 旧 `dubbing` | `components/step7/Compositor.tsx` | 使用已完成片段合成、补充音效/BGM、导出成片 |

旧 `dubbing` 状态只是历史项目兼容别名，当前不再进入独立 Step 6 页面。社区清理已删除未接入入口的旧 Step 6 UI，但保留仍被持久化迁移读取的数据字段。

## 状态与持久化

`stores/projectStore.tsx` 是主项目状态容器，拆分使用 `assetReducer.ts`、`videoReducer.ts`、`historyReducer.ts` 和辅助函数。

持久化链路：

1. `appStatePersistence.ts` 生成带递增 `saveRevision` 的快照。
2. `appStateDb.ts` 将主快照写入 IndexedDB。
3. localStorage 只保留轻量启动元数据、API 设置兼容项和旧格式迁移数据。
4. IndexedDB 不可用时，加载流程回退到 localStorage。
5. 社区前台不挂载账号云同步；跨设备迁移使用本地项目或工作流快照导入导出。

二进制图片和视频不会全部塞进普通 JSON。BFF 保留的云项目协议通过 blob key、清单、直传和对象存储适配器处理大文件，但社区前台不挂载该同步链路。

## API 配置流

前台设置入口是 `components/shared/ApiSettingsModal.tsx`：

- 配置立即写入项目状态并保存在浏览器。
- LLM、图片、视频和语音配置只保存在当前浏览器，不调用账号模型配置接口。
- BFF 的 `commercial-settings.js` 和用户配置协议仍为自托管兼容保留，但社区前台不提供入口。

Canvas 来自独立工作台，内部使用 Zustand 的 `features/canvas/stores/settingsStore.ts`。它支持自定义 provider，但与主工作流设置是两个独立配置域。

## BFF 组成

| 模块 | 职责 |
| --- | --- |
| `auth-store.js` | 用户、密码哈希、HttpOnly 会话、角色、Agent Key、用户模型配置 |
| `commercial-settings.js` | 管理员/用户模型配置、加密、对象存储和 worker 配置 |
| `background-jobs.js` | 文件或 Postgres 任务存储、幂等、租约、事件、取消与重试 |
| `background-worker.js` | 领取任务并分派到 LLM、图片、视频、TTS、BGM、渲染和 Step handlers |
| `cloud-store.js` | 项目结构、blob、清单、直传和云项目删除 |
| `object-storage.js` | 本地目录或 S3/COS 兼容对象存储 |
| `render-jobs.js` | FFmpeg 渲染任务和下载 |
| `templates.js`、`templates/*` | 服务端提示词模板和结构化输出 |
| `agent-api.js` | Agent Key 调用的项目、任务、审计与返修接口 |
| `xyq-agent.js` | 小云雀 Agent 代理 |

全部 BFF 运行模块都从 `bff/server.js` 的挂载链可达；SQL 迁移位于 `bff/migrations`。

## 后台任务

`/api/jobs` 使用用户身份隔离任务。内置 worker 默认跟随 BFF 启动，也可以设置 `BACKGROUND_WORKER_ENABLED=false` 后由独立 worker 使用 `BACKGROUND_WORKER_TOKEN` 领取任务。

任务类型包括 Step 1/3/4、LLM、图片、视频、TTS、BGM 和渲染。全局并发和每类并发可由环境变量或管理员后台调整；修改只影响之后领取的任务，不会中断正在执行的任务。

## 本地模式、云存储与部署

- 社区前台不提供虾客漫账号登录、管理员面板或项目自动云同步。
- BFF 仍保留文件/Postgres 认证、任务和云项目适配器，供现有自托管协议兼容；默认 UI 不调用它们。
- 大媒体可保存在本地卷或腾讯 COS/S3 兼容对象存储。
- Docker 默认把数据目录放在 `/data`，必须挂载持久卷。
- Electron 把 BFF 数据和渲染输出写到应用用户目录，把渲染临时文件写到系统临时目录。

## 源码维护规则

- 文档中的功能声明必须能指向当前入口、路由或调用链。
- 兼容迁移代码不能仅因带有 `legacy` 或 `deprecated` 标记就删除。
- 新 provider 不能把共享密钥写进前端包。
- 删除模块前同时检查 Vite 入口、BFF 入口、package scripts、Electron、Docker、SQL 和字符串引用。
