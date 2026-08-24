# Xiakeman Community

Xiakeman Community 是虾客漫 2026-07-02 源码快照的脱敏社区版，面向本地或小范围部署的 AI 短剧、漫剧与视频制作。社区版不附带平台账号、API Key、积分余额、支付入口或私有上游服务，默认采用 BYOK（Bring Your Own Key）。

当前版本：`0.8.0-community.1`。本文档按当前源码入口和本地构建结果编写，不沿用历史交接文档中的功能结论。

## 当前可用能力

- 主流程：脚本输入/小说改编 → 结构化分析 → 角色、场景、道具资产 → 提示词或故事板 → 批量视频 → 成片合成。
- 独立工作台：图片、视频、节点画布和后台任务中心。
- 自定义 API：对话、图片、视频和语音；音乐配置模型仍未在 UI 中开放。
- 本地数据：IndexedDB 为主存储，localStorage 负责兼容和启动提示。
- 社区交流：右上角“交流群”展示维护者提供的微信二维码；社区前台不提供虾客漫账号登录。
- 使用量统计：保留 Google Analytics 页面访问统计，方便维护者了解实际使用人数；不会主动上报项目内容、模型配置或 API Key。
- 可选部署：Web + BFF、Docker、Electron 桌面打包。

每项能力的入口、依赖和完成状态见 [功能清单](docs/FEATURES.md)。

## 运行要求

- Node.js `20.19+`
- npm
- FFmpeg 和 ffprobe：仅音视频转换、渲染与成片导出需要
- 可访问的模型服务：项目不包含任何可用密钥

## 仓库体积与外部资源

GitHub 仓库只发布可复现构建所需的源码、锁文件、模板、正式 Logo 和交流群图片，不提交以下本地或生成内容：

- `node_modules`、构建输出、桌面安装包和发布压缩包；
- 语音语料库、语音包、本地模型、模型权重和检查点；
- 运行数据库、日志、用户项目、生成媒体和本地环境变量。

依赖请通过 `npm ci` 安装；FFmpeg、模型服务和语音资源由使用者按实际需要自行配置。

## 本地启动

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

默认地址：

- 前端：`http://localhost:8022`
- BFF：`http://localhost:8030`
- 健康检查：`http://localhost:8030/api/health`

Windows 也可以直接运行 `start.bat`。它只在依赖目录不存在时安装依赖，并分别启动 BFF 与 Vite。

## 配置自己的模型

打开页面右上角“API 设置”：

1. 对话模型填写兼容 OpenAI Chat Completions 的服务地址、Key 和模型名。
2. 图片模型按服务协议填写地址、Key、模型和默认尺寸。
3. 视频模型选择本地 Seedance、Seedance 兼容服务、小云雀 Agent、火山方舟或阿里云百炼。
4. 语音模型填写兼容当前 MiMo TTS 调用格式的地址、Key 和模型。
5. 保存后先执行小请求；不要直接用高成本模型批量生成。

设置只保存在当前浏览器。Canvas 工作台还有独立的“画布设置”，两套配置不会自动互相覆盖。完整说明见 [API 配置](docs/API_CONFIGURATION.md)。

## 构建与检查

```powershell
npm run encoding:check
npm run build
npm audit
npm audit --prefix bff
```

BFF 变更至少还应启动服务并请求 `GET /api/health`。本快照没有保留历史测试脚本，不能把“构建通过”写成“所有业务路径已自动测试”。

## Docker

```powershell
npm run docker:prepare
docker build -t xiakeman-community .
docker run --rm -p 8080:80 -v xiakeman-data:/data xiakeman-community
```

访问 `http://localhost:8080`。公网部署前必须设置稳定的加密密钥、安全 Cookie、明确的 CORS 来源和各类上游地址白名单，详见 [部署说明](docs/DEPLOYMENT.md)。

## 文档导航

- [功能清单](docs/FEATURES.md)：源码已接入、条件可用和未开放功能
- [架构说明](docs/ARCHITECTURE.md)：入口、状态、BFF、后台任务与部署结构
- [API 配置](docs/API_CONFIGURATION.md)：BYOK、本地保存、协议和安全边界
- [HTTP API](docs/HTTP_API.md)：当前 BFF 路由总览
- [部署说明](docs/DEPLOYMENT.md)：本地、Docker、数据目录与生产配置
- [已知限制](docs/KNOWN_LIMITATIONS.md)：此快照不应被误解为已商业化产品的部分
- [安全策略](SECURITY.md) 与 [脱敏记录](OPEN_SOURCE_SANITIZATION.md)

## 许可证

代码按 [MIT License](LICENSE) 发布。第三方模型、素材和外部服务仍受各自许可与服务条款约束。
